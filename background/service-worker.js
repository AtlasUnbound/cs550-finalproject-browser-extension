/**
 * PrintShield — Background Service Worker (Manifest V3)
 * Follows MV3 best practices:
 * - No global variable state (all state persisted in chrome.storage.local / session)
 * - Synchronous top-level event listener registration
 * - Async/await pattern for all storage and tab operations
 */

const DEFAULT_MITIGATIONS = {
  canvas: false,
  userAgent: false,
  audio: false,
  webgl: false,
  fonts: false
};

// Weights for the dynamic Privacy Protection Score (total = 100 points)
// Prioritizes Canvas 2D and User-Agent/Navigator per project configuration
const VECTOR_WEIGHTS = {
  canvas: 30,
  userAgent: 30,
  webgl: 15,
  audio: 15,
  fonts: 10
};

function calculatePrivacyScore(mitigations = DEFAULT_MITIGATIONS) {
  let score = 0;
  for (const [vector, weight] of Object.entries(VECTOR_WEIGHTS)) {
    if (mitigations[vector]) {
      score += weight;
    }
  }
  return score;
}

async function updateExtensionBadge(tabId) {
  try {
    const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
    const { mitigations = DEFAULT_MITIGATIONS } = await chrome.storage.local.get('mitigations');
    const tabData = tabDetections[String(tabId)];

    if (!tabData || !tabData.vectors) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    const activeVectors = Object.keys(tabData.vectors).filter((v) => tabData.vectors[v].count > 0);
    const count = activeVectors.length;
    if (count === 0) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    const score = calculatePrivacyScore(mitigations);
    const badgeColor = score >= 60 ? '#0D9488' : score >= 30 ? '#D97706' : '#E11D48';

    await chrome.action.setBadgeText({ tabId, text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
  } catch (err) {
    // Tab may have closed before badge update completed
  }
}

// 1. Initialize default storage on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      mitigations: DEFAULT_MITIGATIONS,
      studyLogs: []
    });
  }
});

// 2. Clear per-tab detections when a tab navigates to a new page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
    delete tabDetections[String(tabId)];
    await chrome.storage.session.set({ tabDetections });
    await chrome.action.setBadgeText({ tabId, text: '' });
  }
});

// 3. Clean up session storage when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
  if (tabDetections[String(tabId)]) {
    delete tabDetections[String(tabId)];
    await chrome.storage.session.set({ tabDetections });
  }
});

// 4. Handle messages from content script bridge and popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'RECORD_FINGERPRINT_EVENT') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false });
          return;
        }

        const { vector, apiMethod, detail, mitigated, timestamp } = message.payload;
        const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
        const key = String(tabId);

        if (!tabDetections[key]) {
          tabDetections[key] = {
            url: sender.tab.url || 'Unknown page',
            vectors: {
              canvas: { count: 0, lastApi: '', detail: '', mitigated: false },
              userAgent: { count: 0, lastApi: '', detail: '', mitigated: false },
              audio: { count: 0, lastApi: '', detail: '', mitigated: false },
              webgl: { count: 0, lastApi: '', detail: '', mitigated: false },
              fonts: { count: 0, lastApi: '', detail: '', mitigated: false }
            },
            recentEvents: []
          };
        }

        const entry = tabDetections[key];
        entry.url = sender.tab.url || entry.url;

        if (!entry.vectors[vector]) {
          entry.vectors[vector] = { count: 0, lastApi: '', detail: '', mitigated: false };
        }

        entry.vectors[vector].count += 1;
        entry.vectors[vector].lastApi = apiMethod;
        entry.vectors[vector].detail = detail;
        entry.vectors[vector].mitigated = mitigated;

        entry.recentEvents.unshift({
          vector,
          apiMethod,
          detail,
          mitigated,
          timestamp
        });

        // Keep the latest 25 events per tab
        if (entry.recentEvents.length > 25) {
          entry.recentEvents.length = 25;
        }

        await chrome.storage.session.set({ tabDetections });
        await updateExtensionBadge(tabId);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'GET_TAB_STATUS') {
        const tabId = message.tabId;
        const { tabDetections = {} } = await chrome.storage.session.get('tabDetections');
        const { mitigations = DEFAULT_MITIGATIONS } = await chrome.storage.local.get('mitigations');
        const score = calculatePrivacyScore(mitigations);

        const tabData = tabDetections[String(tabId)] || {
          url: message.url || '',
          vectors: {
            canvas: { count: 0, lastApi: '', detail: '', mitigated: Boolean(mitigations.canvas) },
            userAgent: { count: 0, lastApi: '', detail: '', mitigated: Boolean(mitigations.userAgent) },
            audio: { count: 0, lastApi: '', detail: '', mitigated: Boolean(mitigations.audio) },
            webgl: { count: 0, lastApi: '', detail: '', mitigated: Boolean(mitigations.webgl) },
            fonts: { count: 0, lastApi: '', detail: '', mitigated: Boolean(mitigations.fonts) }
          },
          recentEvents: []
        };

        sendResponse({
          ok: true,
          mitigations,
          score,
          tabData
        });
        return;
      }

      if (message.type === 'SET_MITIGATION') {
        const { vector, enabled, tabId } = message;
        const { mitigations = DEFAULT_MITIGATIONS, studyLogs = [] } = await chrome.storage.local.get([
          'mitigations',
          'studyLogs'
        ]);

        if (vector === 'ALL') {
          for (const k of Object.keys(DEFAULT_MITIGATIONS)) {
            mitigations[k] = Boolean(enabled);
          }
        } else if (vector in DEFAULT_MITIGATIONS) {
          mitigations[vector] = Boolean(enabled);
        }

        const score = calculatePrivacyScore(mitigations);

        // Log interaction for research study usability tracking (Task 3 evaluation)
        studyLogs.push({
          action: 'toggle_mitigation',
          vector,
          enabled: Boolean(enabled),
          newScore: score,
          timestamp: new Date().toISOString()
        });
        if (studyLogs.length > 100) studyLogs.shift();

        await chrome.storage.local.set({ mitigations, studyLogs });
        if (tabId) {
          await updateExtensionBadge(tabId);
        }

        sendResponse({ ok: true, mitigations, score });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
