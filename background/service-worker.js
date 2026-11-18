/**
 * PrintShield — Background Service Worker (Manifest V3)
 *
 * Responsibilities
 *  - Store the user's mitigation settings (chrome.storage.local).
 *  - (Re)register the MAIN-world protector with chrome.scripting so it runs at
 *    document_start, before page scripts, together with one tiny cfg/<vector>.js
 *    flag file per enabled mitigation (synchronous config, no race).
 *  - Register the font-shield stylesheet while font protection is on.
 *  - Maintain declarativeNetRequest rules that generalize HTTP request headers.
 *  - Record per-tab fingerprint detections (chrome.storage.session), update the
 *    toolbar badge, and answer popup queries.
 *
 * MV3 notes: no long-lived global state (the worker can be stopped at any time),
 * listeners are registered synchronously at top level, and all storage
 * read-modify-write cycles are serialized so concurrent events are not lost.
 */

const VECTOR_IDS = [
  'canvas', 'userAgent', 'headers', 'webgl', 'screen', 'fonts',
  'audio', 'timezone', 'battery', 'network', 'devices'
];

const DEFAULT_MITIGATIONS = Object.fromEntries(VECTOR_IDS.map((v) => [v, false]));

// "Recommended" = everything with little or no effect on how sites work
// (currently every vector).
const RECOMMENDED_EXCLUDES = new Set();

// Privacy score weights (total 100). Roughly follows how identifying each
// surface is in practice (amiunique.org / EFF Cover Your Tracks data).
const VECTOR_WEIGHTS = {
  canvas: 15,
  userAgent: 12,
  webgl: 13,
  fonts: 12,
  screen: 10,
  headers: 8,
  audio: 8,
  timezone: 6,
  battery: 6,
  network: 5,
  devices: 5
};

const PASSIVE_VECTORS = new Set(['headers']); // seen by every server, no script needed

const MAIN_SCRIPT_ID = 'printshield-main';
const FONT_CSS_ID = 'printshield-fonts';

const RULE_IDS = { userAgent: 101, acceptLanguage: 102, acceptNav: 103, acceptImage: 104, clientHints: 105, legacyEtag: 106 }; // 106: removed rule, id kept so it is cleaned up
const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest',
  'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
];
const COMMON_NAV_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const COMMON_IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
// High-entropy Client Hints a server can ask for (Accept-CH). Low-entropy defaults
// (sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform) are sent by every Chrome and kept.
const HIGH_ENTROPY_HINTS = [
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-platform-version', 'sec-ch-ua-arch',
  'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors',
  'sec-ch-device-memory', 'device-memory', 'sec-ch-dpr', 'dpr', 'sec-ch-viewport-width', 'viewport-width',
  'sec-ch-viewport-height', 'sec-ch-width', 'width', 'downlink', 'ect', 'rtt',
  'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion', 'sec-ch-prefers-reduced-transparency'
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let queue = Promise.resolve();
/** Run async read-modify-write jobs one at a time. */
function serialized(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function normalizeMitigations(raw) {
  const out = { ...DEFAULT_MITIGATIONS };
  if (raw && typeof raw === 'object') {
    for (const v of VECTOR_IDS) out[v] = Boolean(raw[v]);
  }
  return out;
}

async function getMitigations() {
  const { mitigations } = await chrome.storage.local.get('mitigations');
  return normalizeMitigations(mitigations);
}

function calculatePrivacyScore(mitigations) {
  let score = 0;
  for (const [vector, weight] of Object.entries(VECTOR_WEIGHTS)) {
    if (mitigations[vector]) score += weight;
  }
  return score;
}

async function fontOsKey() {
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    if (os === 'win') return 'win';
    if (os === 'mac') return 'mac';
    return 'linux';
  } catch {
    return 'win';
  }
}

/**
 * Same rule as protector-main.js: keep the real browser, OS and major version and
 * only round detailed version numbers (Chrome already sends this reduced form, so
 * in practice the header is only rewritten for browsers that do not).
 */
function normalizedUserAgent() {
  const ua = navigator.userAgent || '';
  return ua.replace(/\b((?:Chrome|Chromium|HeadlessChrome|Edg|OPR|CriOS)\/\d+)(?:\.\d+){1,3}/g, '$1.0.0.0');
}

/** "en-US,en;q=0.9" style header that matches the generalized navigator.languages. */
function normalizedAcceptLanguage() {
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en-US'];
  const first = langs[0];
  const base = first.split('-')[0];
  return first.includes('-') && base ? `${first},${base};q=0.9` : first;
}

// ---------------------------------------------------------------------------
// Apply settings: content scripts, header rules, live font CSS
// ---------------------------------------------------------------------------
async function syncContentScripts(mitigations) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ours = existing.map((s) => s.id).filter((id) => id === MAIN_SCRIPT_ID || id === FONT_CSS_ID);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });

  const flags = VECTOR_IDS.filter((v) => mitigations[v]).map((v) => `content/cfg/${v}.js`);
  const scripts = [{
    id: MAIN_SCRIPT_ID,
    matches: ['<all_urls>'],
    js: [...flags, 'content/protector-main.js'],
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    world: 'MAIN',
    persistAcrossSessions: true
  }];
  if (mitigations.fonts) {
    scripts.push({
      id: FONT_CSS_ID,
      matches: ['<all_urls>'],
      css: [`content/fonts/font-shield-${await fontOsKey()}.css`],
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true
    });
  }
  await chrome.scripting.registerContentScripts(scripts);
}

async function syncHeaderRules(mitigations) {
  const addRules = [];
  const realUA = navigator.userAgent || '';
  const uaValue = normalizedUserAgent();

  if (mitigations.userAgent) {
    if (uaValue !== realUA) {
      addRules.push({
        id: RULE_IDS.userAgent,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: uaValue }] },
        condition: { resourceTypes: ALL_RESOURCE_TYPES }
      });
    }
    addRules.push({
      id: RULE_IDS.acceptLanguage,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'accept-language', operation: 'set', value: normalizedAcceptLanguage() }] },
      condition: { resourceTypes: ALL_RESOURCE_TYPES }
    });
  }

  if (mitigations.headers) {
    addRules.push({
      id: RULE_IDS.acceptNav,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'accept', operation: 'set', value: COMMON_NAV_ACCEPT }] },
      condition: { resourceTypes: ['main_frame', 'sub_frame'] }
    });
    addRules.push({
      id: RULE_IDS.acceptImage,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'accept', operation: 'set', value: COMMON_IMAGE_ACCEPT }] },
      condition: { resourceTypes: ['image'] }
    });
    addRules.push({
      id: RULE_IDS.clientHints,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: HIGH_ENTROPY_HINTS.map((header) => ({ header, operation: 'remove' }))
      },
      condition: { resourceTypes: ALL_RESOURCE_TYPES }
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: Object.values(RULE_IDS),
    addRules
  });
}

/** Font CSS can be added to already-open tabs immediately (removal needs a reload). */
async function insertFontShieldIntoOpenTabs() {
  const file = `content/fonts/font-shield-${await fontOsKey()}.css`;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((t) => t.id && /^(https?|file):/.test(t.url || ''))
    .map((t) => chrome.scripting.insertCSS({ target: { tabId: t.id, allFrames: true }, files: [file] }).catch(() => {})));
}

/**
 * Chrome preloads pages (for example Google search results through Google's
 * private prefetch proxy) before you click them. Testing showed those requests
 * still carried the original Accept header, so the header shield also turns off
 * Chrome's "Preload pages" setting while it is on, and hands it back when off.
 */
async function syncPreloading(mitigations) {
  if (!chrome.privacy || !chrome.privacy.network || !chrome.privacy.network.networkPredictionEnabled) return;
  const setting = chrome.privacy.network.networkPredictionEnabled;
  if (mitigations.headers) await setting.set({ value: false });
  else await setting.clear({});
}

async function applyMitigations(mitigations, previous) {
  const results = await Promise.allSettled([
    syncContentScripts(mitigations), syncHeaderRules(mitigations), syncPreloading(mitigations)
  ]);
  results.forEach((r) => {
    if (r.status === 'rejected') console.warn('PrintShield: failed to apply settings', r.reason);
  });
  if (mitigations.fonts && previous && !previous.fonts) await insertFontShieldIntoOpenTabs();
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function updateExtensionBadge(tabId, tabData, mitigations) {
  try {
    const detected = Object.keys(tabData?.vectors || {})
      .filter((v) => !PASSIVE_VECTORS.has(v) && tabData.vectors[v].count > 0);
    if (detected.length === 0) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const exposed = detected.filter((v) => !mitigations[v]).length;
    const color = exposed === 0 ? '#0D9488' : exposed < detected.length ? '#D97706' : '#E11D48';
    await chrome.action.setBadgeText({ tabId, text: String(detected.length) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setTitle({
      tabId,
      title: `PrintShield — this page read ${detected.length} fingerprint type(s); ${exposed} unprotected`
    });
  } catch {
    // Tab closed before the badge update finished.
  }
}

// ---------------------------------------------------------------------------
// Detection records
// ---------------------------------------------------------------------------
function emptyVector() {
  return { count: 0, lastApi: '', detail: '', mitigated: false, frame: null, apis: {} };
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
}

async function recordEvents(tab, frame, events) {
  const key = String(tab.id);
  const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
  const entry = tabDetections[key] || { url: tab.url || '', vectors: {}, recentEvents: [] };
  entry.url = tab.url || entry.url;
  const frameLabel = frame ? cleanText(frame, 80) : null;

  for (const ev of events) {
    if (!ev || !VECTOR_IDS.includes(ev.vector)) continue;
    const count = Math.max(1, Math.min(100000, Number(ev.count) || 1));
    const api = cleanText(ev.api, 90);
    const detail = cleanText(ev.detail, 180);
    const v = entry.vectors[ev.vector] || emptyVector();
    v.count += count;
    v.lastApi = api;
    v.detail = detail;
    v.mitigated = Boolean(ev.mitigated);
    v.frame = frameLabel;
    if (v.apis[api] !== undefined || Object.keys(v.apis).length < 25) v.apis[api] = (v.apis[api] || 0) + count;
    entry.vectors[ev.vector] = v;

    entry.recentEvents.unshift({
      vector: ev.vector,
      api,
      detail,
      mitigated: Boolean(ev.mitigated),
      count,
      frame: frameLabel,
      timestamp: Number(ev.timestamp) || Date.now()
    });
  }
  if (entry.recentEvents.length > 40) entry.recentEvents.length = 40;

  tabDetections[key] = entry;
  await chrome.storage.session.set({ tabDetections });
  await updateExtensionBadge(tab.id, entry, await getMitigations());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => serialized(async () => {
  const stored = await chrome.storage.local.get(['mitigations', 'studyLogs']);
  const mitigations = normalizeMitigations(stored.mitigations);
  await chrome.storage.local.set({
    mitigations,
    studyLogs: Array.isArray(stored.studyLogs) ? stored.studyLogs : []
  });
  await applyMitigations(mitigations, details.reason === 'install' ? null : mitigations);
}));

chrome.runtime.onStartup.addListener(() => serialized(async () => {
  await applyMitigations(await getMitigations(), null);
}));

// Clear per-tab detections when the tab starts loading a new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  serialized(async () => {
    const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
    if (tabDetections[String(tabId)]) {
      delete tabDetections[String(tabId)];
      await chrome.storage.session.set({ tabDetections });
    }
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  });
});

chrome.tabs.onRemoved.addListener((tabId) => serialized(async () => {
  const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
  if (tabDetections[String(tabId)]) {
    delete tabDetections[String(tabId)];
    await chrome.storage.session.set({ tabDetections });
  }
}));

// ---------------------------------------------------------------------------
// Messages from the bridge and the popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'RECORD_FINGERPRINT_EVENTS') {
        const tab = sender.tab;
        if (!tab || tab.id === undefined || !Array.isArray(message.events)) {
          sendResponse({ ok: false });
          return;
        }
        await serialized(() => recordEvents(tab, message.frame, message.events.slice(0, 200)));
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'GET_TAB_STATUS') {
        const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
        const mitigations = await getMitigations();
        sendResponse({
          ok: true,
          mitigations,
          score: calculatePrivacyScore(mitigations),
          weights: VECTOR_WEIGHTS,
          tabData: tabDetections[String(message.tabId)] || { url: message.url || '', vectors: {}, recentEvents: [] }
        });
        return;
      }

      if (message.type === 'SET_MITIGATION') {
        const result = await serialized(async () => {
          const previous = await getMitigations();
          const mitigations = { ...previous };
          const { vector, enabled } = message;

          if (vector === 'ALL') {
            VECTOR_IDS.forEach((v) => { mitigations[v] = Boolean(enabled); });
          } else if (vector === 'RECOMMENDED') {
            VECTOR_IDS.forEach((v) => { mitigations[v] = !RECOMMENDED_EXCLUDES.has(v); });
          } else if (VECTOR_IDS.includes(vector)) {
            mitigations[vector] = Boolean(enabled);
          }

          const score = calculatePrivacyScore(mitigations);
          const { studyLogs = [] } = await chrome.storage.local.get('studyLogs');
          // Interaction log for the user study's usability evaluation (Task 3).
          studyLogs.push({
            action: 'toggle_mitigation',
            vector,
            enabled: Boolean(enabled),
            newScore: score,
            timestamp: new Date().toISOString()
          });
          while (studyLogs.length > 200) studyLogs.shift();

          await chrome.storage.local.set({ mitigations, studyLogs });
          await applyMitigations(mitigations, previous);

          if (message.tabId) {
            const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
            await updateExtensionBadge(message.tabId, tabDetections[String(message.tabId)], mitigations);
          }
          return { mitigations, score };
        });
        sendResponse({ ok: true, ...result });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the channel open for the async response
});
