/**
 * PrintShield — Popup Dashboard Controller
 * - Protection level ring + status, first-run introduction, undo for "Turn all off"
 * - 11 fingerprinting vectors with plain-language education (Study Task 2)
 * - Real-time mitigation toggles (Study Task 3)
 * - Live activity feed of fingerprint reads on the current tab
 */

const VECTORS_METADATA = [
  {
    id: 'canvas',
    plainName: "Hidden drawing test",
    name: "Canvas",
    priority: true,
    shortSummary: "Sites draw a hidden picture and check how your computer drew it.",
    whatItReveals:
      "A site secretly draws text and shapes, then reads the picture back. Your graphics card, drivers, system and fonts each change the result very slightly, so the picture works like a code for your computer.",
    whyItMatters:
      "This is one of the strongest ways to recognize a browser. It still works after you clear cookies or use a private window.",
    howMitigationWorks:
      "Changes a few pixels by an amount too small to see. The change is new on every visit, so the code is different each time and cannot link your visits.",
    siteImpact: "None you would notice: the changes are invisible.",
    limit: "Test websites will still call this value \"unique\". That is expected: it changes on every visit, so it cannot be used to follow you.",
    cantHide:
      'Test sites such as amiunique.org will call your canvas "unique (0.00%)". With protection on, that is the goal: the value changes on every visit, so it never matches again and cannot link your visits. Cover Your Tracks correctly labels it "randomized". Blocking canvas outright would break many sites.'
  },
  {
    id: 'userAgent',
    plainName: "Browser & device details",
    name: "User agent, CPU, memory",
    priority: true,
    shortSummary: "Your browser version, system, processor, memory and languages.",
    whatItReveals:
      "Your browser name and version, your operating system, how many processor cores and how much memory you have, your languages, and detailed version numbers your browser can share on request.",
    whyItMatters:
      "Each detail alone is common, but together they quickly narrow down who you are.",
    howMitigationWorks:
      "Reports the most common hardware (8 processor cores, 8 GB of memory) and only your main language. It rounds detailed version numbers. Your real browser and version stay visible, because faking them makes you stand out.",
    siteImpact: "None you would notice: sites still see the right browser, so pages look the same.",
    limit: "Sites can still see which browser and version you use. Faking it would make you stand out more, not less.",
    cantHide:
      'Your browser version. Chrome 157 looks rare on amiunique.org (about 0.06%) only because its database spans years of older browsers. Cover Your Tracks, which uses recent visitors, finds about 1 in 35 browsers share it. Faking an older version was tested: it still scored only 0.38% and contradicted your HTTP headers and real browser features, which trackers can spot. The list of navigator properties works the same way: every Chrome 157 user has the same list, so PrintShield leaves it alone (hiding just 2 properties made it unique).'
  },
  {
    id: 'headers',
    plainName: "Info sent with every request",
    name: "HTTP headers",
    passive: true,
    shortSummary: "Details your browser sends to a website before the page even loads.",
    whatItReveals:
      "Every time your browser asks a website for something, it attaches notes: which browser you use, which image types it can show, your language and, if the site asks, details like memory and connection speed.",
    whyItMatters:
      "The website gets these notes without running any code, so you cannot see it happen. Unusual notes make you stand out. Tip: the \"Do Not Track\" setting sounds private, but few people use it, so it makes you easier to spot.",
    howMitigationWorks:
      "Sends the most common version of these notes and removes the detailed extras. It also turns off Chrome's \"Preload pages\" setting while on, because preloaded pages skip this protection.",
    siteImpact: "Very small: some images may load in a slightly older format, and links are not loaded ahead of time.",
    limit: "Your browser version and language are still sent. Reloading a page adds a few extra details that no extension can remove.",
    cantHide:
      'The browser version in the User-Agent header (see Browser Identity) and your language, since changing the language would show you sites in the wrong language. "If-None-Match" (an ETag, which works like a cookie stored in your cache) and "Cache-Control: max-age=0" are added by Chrome\'s cache after extensions run, so no extension can remove them. They only appear when you revisit or reload a page; clear your cache or open the test in a fresh window to avoid them.'
  },
  {
    id: 'webgl',
    plainName: "Graphics card",
    name: "WebGL / WebGPU",
    shortSummary: "The exact model of your graphics card and what it can do.",
    whatItReveals:
      "The brand and model of your graphics card (for example \"NVIDIA GeForce RTX 3060\"), dozens of technical limits it has, and the exact pixels of 3D scenes it draws.",
    whyItMatters:
      "Graphics cards and their limits vary a lot between computers, so together they are often unique to you.",
    howMitigationWorks:
      "Reports the most common real graphics card name (on Windows, Microsoft's built-in \"Basic Render Driver\"), reports common limits, hides rare features and adds invisible changes to 3D images.",
    siteImpact: "Small: 3D sites still work. A few very advanced 3D apps may lose rare features, and some sites that check for robots may ask for a CAPTCHA more often.",
    limit: "Some graphics details come from your real hardware and cannot be changed. A few sites that check for robots may show an extra CAPTCHA.",
    cantHide:
      'WebGL parameters and the extension list come from your browser version and real graphics hardware. PrintShield caps the limits and hides rare extensions, but it cannot add features your GPU lacks, so this can stay uncommon. "WebGL Data" is a rendered image, randomized like canvas, so test sites list it as unique even though it cannot be linked. On Cover Your Tracks the Basic Render Driver string is shared by about 1 in 114 browsers, compared with 1 in 490 for the most common Intel laptop GPU. A few anti-bot services treat software rendering as a hint of automation and may show an extra CAPTCHA; turn this shield off on such a site if that happens.'
  },
  {
    id: 'screen',
    plainName: "Screen size",
    name: "Screen & window",
    shortSummary: "Your screen size and where your window sits on it.",
    whatItReveals:
      "Your screen's width and height, the space left after your taskbar, how many colors it shows, and where your browser window is placed.",
    whyItMatters:
      "An unusual screen size or taskbar can be shared by fewer than 1 in 100 people. The window position can reveal that you use more than one monitor.",
    howMitigationWorks:
      "Reports the most common screen size that fits your window (for example 1920×1080 with a normal taskbar) and a standard window position.",
    siteImpact: "None you would notice: pages use your real window size for their layout.",
    limit: "The size of your browser window stays real, because pages need it to lay themselves out.",
    cantHide:
      'Your browser window size is not changed, because pages need it for layout. A maximized window can still hint at your real usable screen area.'
  },
  {
    id: 'fonts',
    plainName: "Installed fonts",
    name: "Font list",
    shortSummary: "The fonts on your computer reveal which apps you have installed.",
    whatItReveals:
      "Sites test hundreds of font names to see which ones you have. Apps like Microsoft Office or Adobe add their own fonts, so the list hints at your software, your languages and even your job.",
    whyItMatters:
      "Your font list is one of the strongest ways to recognize you. Test sites often find a font list shared by 1 in 100 browsers or fewer.",
    howMitigationWorks:
      "Shows the most common font list for your system (on Windows: the fonts that come with Windows and Microsoft Office). Rare fonts are hidden and common ones you lack are filled in, so you match the biggest crowd.",
    siteImpact: "Small: a page that asks for a hidden font shows a standard font instead. Fonts that websites download themselves still work.",
    limit: "No font list is shared by everyone, so this makes you much less unique but cannot make you invisible.",
    cantHide:
      'No font list is shared by everyone. The most common Windows list is "Windows + Microsoft Office", so PrintShield shows exactly that: Office fonts you lack are emulated and every other extra font is hidden. Advanced scripts that inspect how a font draws, not just whether it exists, may still notice differences.'
  },
  {
    id: 'audio',
    plainName: "Hidden sound test",
    name: "Web Audio",
    shortSummary: "Sites make a silent sound and check how your computer processed it.",
    whatItReveals:
      "A site creates a sound without playing it, then reads back the result. Your processor, system and browser each produce slightly different numbers.",
    whyItMatters:
      "The result stays the same for your computer and survives clearing cookies.",
    howMitigationWorks:
      "Adds a change about a million times quieter than the sound itself. It is new on every visit, so the result cannot link your visits.",
    siteImpact: "None: far too small to hear.",
    limit: "Test websites will still call this value \"unique\". That is expected: it changes on every visit, so it cannot be used to follow you.",
    cantHide:
      'Like canvas, test sites show the audio value as unique because it changes on each visit, which is what makes it unlinkable. Your audio sample rate (44.1 or 48 kHz) comes from your sound hardware and is left as is.'
  },
  {
    id: 'timezone',
    plainName: "Time zone",
    name: "Intl / Date",
    shortSummary: "Your time zone narrows down where you live.",
    whatItReveals:
      "Your time zone's name (for example America/New_York) and how many hours you are from UTC, the world's reference time.",
    whyItMatters:
      "Together with your language, it places you in a region. It can also give away people using a VPN, when their time zone does not match their location.",
    howMitigationWorks:
      "Reports the most widely used name for your time zone (for example America/Detroit becomes America/New_York, which runs the same clock). If you already use the common name, nothing changes.",
    siteImpact: "None: every time shown on websites stays correct.",
    limit: "Your clock stays correct, so sites can still tell roughly where in the world you are. Your internet address reveals that anyway. If you already use the most common zone name, nothing needs to change.",
    cantHide:
      'Your UTC offset (for example UTC-05:00) stays visible: changing it would make every clock on the web wrong, and your IP address reveals your region anyway. Pretending to be in UTC was tested: common on amiunique.org (about 21%) but rare on Cover Your Tracks (1 in 91), where most UTC visitors are servers or Tor users.'
  },
  {
    id: 'battery',
    plainName: "Battery level",
    name: "Battery API",
    shortSummary: "Your exact battery level and whether you are charging.",
    whatItReveals:
      "How full your battery is (for example 60%), whether it is charging and how long it will last.",
    whyItMatters:
      "Your battery level changes slowly, so for a few minutes it can link your visits to different sites, even in a private window.",
    howMitigationWorks: "Always reports a fully charged, plugged-in device, the most common answer on desktop computers.",
    siteImpact: "None for almost all sites.",
    limit: "Nothing important.",
    cantHide:
      'Nothing important. Desktop computers without a battery already report a full, charging battery.'
  },
  {
    id: 'network',
    plainName: "Internet connection",
    name: "Network Information API",
    shortSummary: "Your connection type and estimated speed.",
    whatItReveals:
      "Your connection type (such as 4G), estimated download speed, response time and whether data saver is on.",
    whyItMatters:
      "These numbers depend on your internet provider and location, and they add to what makes you unique.",
    howMitigationWorks: "Reports the most common values: 4G, 10 Mbps, 50 ms response time and data saver off.",
    siteImpact: "Very small: video sites may pick a quality level a little less precisely.",
    limit: "Your internet address and real connection speed are still visible to the websites you visit.",
    cantHide:
      'Your IP address and your real connection speed are still visible to servers. This only changes what page scripts can read.'
  },
  {
    id: 'devices',
    plainName: "Keyboard, camera & mic",
    name: "Keyboard layout, media devices",
    shortSummary: "Your keyboard layout and how many cameras and microphones you have.",
    whatItReveals:
      "Your keyboard layout, which hints at your language and country, how many cameras, microphones and speakers you have, and your camera and microphone permission settings.",
    whyItMatters:
      "A keyboard layout other than US, or an unusual number of devices, is rare. Test sites found some keyboard layouts shared by only about 6 in 100 users.",
    howMitigationWorks:
      "Reports a US keyboard and one camera, one microphone and one speaker, until you allow a site to use your camera or microphone. Permission checks are only reported, since most people have the same default settings.",
    siteImpact: "Small: games that show key names may show US key names.",
    limit: "When you type on a page, sites can still see which letters your keys produce.",
    cantHide:
      'Permission states (for example camera: prompt) are left alone, because the defaults are what most people have. If you actually type on a page, scripts can still see which characters your keys produce.'
  }
];

const VECTOR_NAMES = Object.fromEntries(VECTORS_METADATA.map((m) => [m.id, m.plainName]));

let currentTabId = null;
let currentTabUrl = '';
let currentWeights = {};
let currentMitigations = {};
let undoSnapshot = null;
let undoTimer = null;
const expandedTooltips = new Set();
const expandedExpert = new Set();
let pendingRefresh = null;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isTestLab(url) {
  return String(url || '').startsWith(chrome.runtime.getURL('sandbox/'));
}

// The Test Lab is an extension page, but PrintShield runs on it like on any website.
function isWebPage(url) {
  return /^(https?|file):/.test(url || '') || isTestLab(url);
}

function updateScoreUI(score) {
  const scoreValueEl = document.getElementById('score-value');
  const ringFillEl = document.getElementById('metric-ring-progress');
  const badgeEl = document.getElementById('protection-badge');
  const descEl = document.getElementById('metric-explanation');

  scoreValueEl.textContent = String(score);
  document.querySelector('.metric-ring-container').setAttribute('aria-label', `Protection level: ${score} percent`);
  const circumference = 219.91; // 2 * PI * 35
  ringFillEl.style.strokeDashoffset = String(circumference - (score / 100) * circumference);

  badgeEl.classList.remove('status-low', 'status-medium', 'status-high');
  if (score >= 75) {
    ringFillEl.style.stroke = '#10b981';
    badgeEl.classList.add('status-high');
    badgeEl.textContent = 'Well protected';
    descEl.textContent = 'Your browser reports common details, so it looks like thousands of other browsers.';
  } else if (score >= 35) {
    ringFillEl.style.stroke = '#f59e0b';
    badgeEl.classList.add('status-medium');
    badgeEl.textContent = 'Partly protected';
    descEl.textContent = 'Some details are protected. The rest can still be combined to recognize you.';
  } else {
    ringFillEl.style.stroke = '#f43f5e';
    badgeEl.classList.add('status-low');
    badgeEl.textContent = 'Not protected';
    descEl.textContent = 'Websites can combine details about your computer into an ID that follows you, even without cookies.';
  }
}

// Every status has an icon and words, so it never relies on color alone.
function statusFor(meta, vState, isProtected, onWebPage) {
  if (meta.passive) {
    if (!onWebPage) return { cls: 'activity-idle', label: 'Sent to every site' };
    return isProtected
      ? { cls: 'activity-protected', label: '🛡️ Sent, made common' }
      : { cls: 'activity-detected', label: '⚠️ Sent to this site' };
  }
  const isDetected = vState.count > 0;
  if (isDetected && isProtected) return { cls: 'activity-protected', label: '🛡️ Checked · protected' };
  if (isDetected) return { cls: 'activity-detected', label: '⚠️ Checked · not protected' };
  if (isProtected) return { cls: 'activity-protected', label: '🛡️ Protected' };
  return { cls: 'activity-idle', label: 'Not checked yet' };
}

function renderVectorsList(tabData, mitigations) {
  const container = document.getElementById('vectors-container');
  const detectedSummary = document.getElementById('detected-summary');
  const vectorsState = tabData?.vectors || {};
  const onWebPage = isWebPage(currentTabUrl);
  let activeCount = 0;
  let exposedCount = 0;

  const html = VECTORS_METADATA.map((meta) => {
    const vState = vectorsState[meta.id] || { count: 0, lastApi: '', detail: '', apis: {} };
    const isProtected = Boolean(mitigations[meta.id]);
    if (!meta.passive && vState.count > 0) {
      activeCount += 1;
      if (!isProtected) exposedCount += 1;
    }
    const status = statusFor(meta, vState, isProtected, onWebPage);
    const isExpanded = expandedTooltips.has(meta.id);
    const weight = currentWeights[meta.id] || 0;
    const apiList = Object.entries(vState.apis || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([api, n]) => `<li><code>${escapeHtml(api)}</code> × ${n}</li>`)
      .join('');

    let liveReadout;
    if (meta.passive) {
      liveReadout = '<div class="live-api-readout">Your browser sends this automatically when it loads a page, so the website already has it.</div>';
    } else if (vState.lastApi) {
      liveReadout = `<div class="live-api-readout">
          <strong>On this page:</strong> checked ${vState.count} time${vState.count === 1 ? '' : 's'}.
          Latest: ${escapeHtml(vState.detail)}${vState.frame ? ` <span class="frame-chip">in ${escapeHtml(vState.frame)}</span>` : ''}
        </div>`;
    } else {
      liveReadout = '<div class="live-api-readout">This page has not checked this yet. Open the Test Lab (top right) to see it happen.</div>';
    }

    const tags = [
      meta.priority ? '<span class="priority-tag" title="One of the details that identifies browsers best">High risk</span>' : '',
      meta.passive ? '<span class="priority-tag passive-tag" title="Sent by your browser without any page code, so pages cannot show you when it happens">Automatic</span>' : ''
    ].join('');

    return `
      <div class="vector-card ${meta.priority ? 'focus-vector' : ''} ${isProtected ? 'mitigated-card' : ''} ${
        !isProtected && vState.count > 0 ? 'exposed-card' : ''}">
        <div class="vector-top">
          <div class="vector-title-group">
            <span class="vector-name">${escapeHtml(meta.plainName)}</span>
            ${tags}
          </div>
          <label class="switch" title="${isProtected ? 'Protection on' : 'Protection off'}. Worth ${weight}% of your protection level.">
            <input type="checkbox" data-vector="${meta.id}" ${isProtected ? 'checked' : ''} aria-label="Protect ${escapeHtml(meta.plainName)}">
            <span class="slider"></span>
          </label>
        </div>
        <div class="vector-summary">${escapeHtml(meta.shortSummary)}</div>
        <div class="vector-subrow">
          <span class="activity-badge ${status.cls}">${escapeHtml(status.label)}</span>
          <button type="button" class="tooltip-trigger" data-tooltip-btn="${meta.id}" aria-expanded="${isExpanded}" aria-controls="tooltip-${meta.id}">
            ${isExpanded ? 'Show less ▲' : 'Learn more ▼'}
          </button>
        </div>
        <div class="vector-tooltip" id="tooltip-${meta.id}" ${isExpanded ? '' : 'hidden'}>
          <div class="tooltip-section">
            <span class="tooltip-heading">🔍 What sites can learn</span>
            <span>${escapeHtml(meta.whatItReveals)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">⚠️ Why it can identify you</span>
            <span>${escapeHtml(meta.whyItMatters)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">🛡️ What PrintShield does</span>
            <span>${escapeHtml(meta.howMitigationWorks)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">⚖️ Side effects</span>
            <span>${escapeHtml(meta.siteImpact)}</span>
          </div>
          <div class="tooltip-section limits-section">
            <span class="tooltip-heading">🚧 What it can't hide</span>
            <span>${escapeHtml(meta.limit)}</span>
          </div>
          ${liveReadout}
          <details class="expert-details" data-expert="${meta.id}" ${expandedExpert.has(meta.id) ? 'open' : ''}>
            <summary>Technical details (${escapeHtml(meta.name)})</summary>
            <p>${escapeHtml(meta.cantHide)}</p>
            ${apiList ? `<p class="expert-label">Browser features this page used:</p><ul class="api-list">${apiList}</ul>` : ''}
          </details>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
  const total = VECTORS_METADATA.filter((m) => !m.passive).length;
  detectedSummary.textContent = `${activeCount} of ${total} checked by this page`;

  const alertEl = document.getElementById('page-alert');
  alertEl.removeAttribute('data-ok');
  alertEl.removeAttribute('data-info');
  if (!onWebPage) {
    alertEl.hidden = false;
    alertEl.setAttribute('data-info', '');
    alertEl.textContent = 'ℹ️ PrintShield only works on websites, not on browser pages like this one. Open any website, or try the Test Lab.';
  } else if (exposedCount > 0) {
    const one = exposedCount === 1;
    alertEl.hidden = false;
    alertEl.textContent = `⚠️ This page checked ${exposedCount} detail${one ? '' : 's'} that ${one ? 'is' : 'are'} not protected. Turn on protection above to hide ${one ? 'it' : 'them'}.`;
  } else if (activeCount > 0) {
    alertEl.hidden = false;
    alertEl.setAttribute('data-ok', '');
    alertEl.textContent = `✅ This page checked ${activeCount} detail${activeCount === 1 ? '' : 's'} about your browser, and PrintShield protected all of them.`;
  } else {
    alertEl.hidden = true;
  }

  container.querySelectorAll('input[type="checkbox"][data-vector]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      hideUndo();
      await setMitigation(e.target.getAttribute('data-vector'), e.target.checked);
    });
  });

  container.querySelectorAll('button[data-tooltip-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tooltip-btn');
      const drawer = document.getElementById(`tooltip-${id}`);
      if (!drawer) return;
      const open = !expandedTooltips.has(id);
      if (open) expandedTooltips.add(id);
      else expandedTooltips.delete(id);
      drawer.hidden = !open;
      btn.textContent = open ? 'Show less ▲' : 'Learn more ▼';
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  // Remember open "Technical details" sections across live refreshes.
  container.querySelectorAll('details[data-expert]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const id = el.getAttribute('data-expert');
      if (el.open) expandedExpert.add(id);
      else expandedExpert.delete(id);
    });
  });
}

function renderActivityFeed(tabData) {
  const feed = document.getElementById('activity-feed');
  const events = (tabData?.recentEvents || []).slice(0, 12);
  if (events.length === 0) {
    feed.innerHTML = '<li class="feed-empty">Nothing yet. When this page checks a detail about your browser, it will appear here.</li>';
    return;
  }
  feed.innerHTML = events.map((ev) => {
    const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<li class="feed-item ${ev.mitigated ? 'feed-masked' : 'feed-exposed'}">
        <span class="feed-dot" aria-hidden="true"></span>
        <div class="feed-body">
          <div class="feed-title">${escapeHtml(VECTOR_NAMES[ev.vector] || ev.vector)}
            <span class="feed-state">${ev.mitigated ? '🛡️ protected' : '⚠️ not protected'}</span>
            ${ev.count > 1 ? `<span class="feed-count" title="Checked ${ev.count} times">×${ev.count}</span>` : ''}
          </div>
          <div class="feed-detail">${escapeHtml(ev.detail)}${ev.frame ? ` <span class="frame-chip">in ${escapeHtml(ev.frame)}</span>` : ''}</div>
        </div>
        <span class="feed-time">${escapeHtml(time)}</span>
      </li>`;
  }).join('');
}

function showReloadNotice() {
  document.getElementById('reload-notice').hidden = !isWebPage(currentTabUrl);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoSnapshot = null;
  document.getElementById('undo-bar').hidden = true;
}

async function setMitigation(vector, enabled) {
  const response = await chrome.runtime.sendMessage({ type: 'SET_MITIGATION', vector, enabled, tabId: currentTabId });
  if (response && response.ok) {
    updateScoreUI(response.score);
    showReloadNotice();
    await refreshDashboard();
  }
  return response;
}

// "Turn all off" can be undone for a few seconds, so a misclick costs nothing.
async function turnAllOff() {
  const snapshot = Object.keys(currentMitigations).filter((id) => currentMitigations[id]);
  await setMitigation('ALL', false);
  if (snapshot.length === 0) return;
  undoSnapshot = snapshot;
  document.getElementById('undo-bar').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 10000);
}

async function undoTurnAllOff() {
  const snapshot = undoSnapshot;
  hideUndo();
  if (!snapshot) return;
  for (const id of snapshot) {
    await chrome.runtime.sendMessage({ type: 'SET_MITIGATION', vector: id, enabled: true, tabId: currentTabId });
  }
  showReloadNotice();
  await refreshDashboard();
}

async function refreshDashboard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;
  currentTabUrl = tab.url || '';

  const domainEl = document.getElementById('active-domain');
  if (isTestLab(currentTabUrl)) {
    domainEl.textContent = 'Watching: PrintShield Test Lab';
  } else {
    try {
      const urlObj = new URL(currentTabUrl);
      domainEl.textContent = `Watching: ${urlObj.hostname || tab.title || 'local file'}`;
    } catch {
      domainEl.textContent = `Watching: ${tab.title || 'browser tab'}`;
    }
  }

  const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', tabId: tab.id, url: tab.url });
  if (response && response.ok) {
    currentWeights = response.weights || {};
    currentMitigations = response.mitigations || {};
    updateScoreUI(response.score);
    renderVectorsList(response.tabData, currentMitigations);
    renderActivityFeed(response.tabData);
  }
}

function scheduleRefresh() {
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(async () => {
    pendingRefresh = null;
    await refreshDashboard();
  }, 300);
}

// First-run introduction: shown until the user dismisses it, reopened with the "?" button.
async function setupIntro() {
  const intro = document.getElementById('intro');
  const helpBtn = document.getElementById('help-btn');
  let dismissed = false;
  try {
    dismissed = Boolean((await chrome.storage.local.get('introDismissed')).introDismissed);
  } catch { /* show the intro if storage is unavailable */ }
  intro.hidden = dismissed;
  helpBtn.setAttribute('aria-expanded', String(!dismissed));
  document.getElementById('intro-dismiss').addEventListener('click', async () => {
    intro.hidden = true;
    helpBtn.setAttribute('aria-expanded', 'false');
    helpBtn.focus();
    try { await chrome.storage.local.set({ introDismissed: true }); } catch { /* ignore */ }
  });
  helpBtn.addEventListener('click', () => {
    intro.hidden = !intro.hidden;
    helpBtn.setAttribute('aria-expanded', String(!intro.hidden));
    if (!intro.hidden) intro.scrollIntoView({ block: 'nearest' });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await setupIntro();
  await refreshDashboard();

  document.getElementById('protect-all-btn').addEventListener('click', () => { hideUndo(); setMitigation('RECOMMENDED', true); });
  document.getElementById('reset-all-btn').addEventListener('click', turnAllOff);
  document.getElementById('undo-btn').addEventListener('click', undoTurnAllOff);
  document.getElementById('open-sandbox-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('sandbox/test-lab.html') });
  });
  document.getElementById('reload-tab-btn').addEventListener('click', async () => {
    if (currentTabId) await chrome.tabs.reload(currentTabId);
    document.getElementById('reload-notice').hidden = true;
  });

  // Live updates: re-render when the current tab records new detections.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.tabDetections) scheduleRefresh();
  });
});
