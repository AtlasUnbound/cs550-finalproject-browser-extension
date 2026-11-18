/**
 * PrintShield — Popup Dashboard Controller
 * - Visual Privacy Protection Metric (SVG ring + status)
 * - 11 fingerprinting vectors with plain-language education (Study Task 2)
 * - Real-time mitigation toggles (Study Task 3)
 * - Live activity feed of fingerprint reads on the current tab
 */

const VECTORS_METADATA = [
  {
    id: 'canvas',
    name: 'Canvas Image Rendering',
    priority: true,
    shortSummary: 'Hidden drawings reveal tiny differences in how your computer draws graphics.',
    whatItReveals:
      'A site secretly draws text and shapes, then reads back the pixels. Your graphics card, drivers, operating system and fonts each change the result very slightly, producing a "canvas hash".',
    whyItMatters:
      'Canvas hashes are among the most identifying signals measured by amiunique.org. The hash survives clearing cookies and private browsing.',
    howMitigationWorks:
      'Adds invisible one-bit changes to a few pixels whenever a site exports or reads a canvas. The changes stay the same within a page but are new on every page load, so your hash cannot be linked across visits.',
    siteImpact: 'Very low: the changes are far too small to see.',
    cantHide:
      'Test sites such as amiunique.org will call your canvas "unique (0.00%)". With protection on, that is the goal: the value changes on every visit, so it never matches again and cannot link your visits. Cover Your Tracks correctly labels it "randomized". Blocking canvas outright would break many sites.'
  },
  {
    id: 'userAgent',
    name: 'Browser Identity & Hardware',
    priority: true,
    shortSummary: 'Browser version, OS, CPU cores, memory, languages and device hints.',
    whatItReveals:
      'The user agent and platform, CPU core count, memory size, languages, detailed "Client Hints" (exact OS build, CPU type, device model) and the list of browser features (navigator properties).',
    whyItMatters:
      'Each value alone is common, but together they narrow you down fast. Faking an old browser version backfires: it no longer matches your real HTTP headers and features, which is itself rare.',
    howMitigationWorks:
      'Reports the most common values (8 cores, 8 GB, your main language only) but keeps your real browser and version, so JavaScript and HTTP headers agree. Detailed hints (exact OS build, full version number) are rounded and rare navigator properties are hidden.',
    siteImpact: 'Low: sites still see the correct browser and OS, so layouts are unaffected.',
    cantHide:
      'Your browser version. Chrome 157 looks rare on amiunique.org (about 0.06%) only because its database spans years of older browsers. Cover Your Tracks, which uses recent visitors, finds about 1 in 35 browsers share it. Faking an older version was tested: it still scored only 0.38% and contradicted your HTTP headers and real browser features, which trackers can spot. The list of navigator properties works the same way: every Chrome 157 user has the same list, so PrintShield leaves it alone (hiding just 2 properties made it unique).'
  },
  {
    id: 'headers',
    name: 'HTTP Request Headers',
    passive: true,
    shortSummary: 'Sent to every server with every request, before any script runs.',
    whatItReveals:
      'Headers such as User-Agent, Accept (which file formats you support), Accept-Language and, when a server asks, Client Hints like device memory, screen width or network speed.',
    whyItMatters:
      'This is passive fingerprinting: the server sees it without running any code, so it cannot be detected on the page. Rare format lists or detailed hints make you stand out. Tip: turning on "Do Not Track" sounds private but makes you rarer, because few people enable it.',
    howMitigationWorks:
      'Replaces the Accept header with the most common Chrome value and strips the detailed Client Hints that servers can request. It also turns off Chrome\'s "Preload pages" setting while on, because pages preloaded from Google search skip extension header rules. Language and User-Agent headers are aligned by the Browser Identity shield.',
    siteImpact: 'Low: a site may serve a slightly less optimized image format, and links open without being preloaded.',
    cantHide:
      'The browser version in the User-Agent header (see Browser Identity) and your language, since changing the language would show you sites in the wrong language. "If-None-Match" (an ETag, which works like a cookie stored in your cache) and "Cache-Control: max-age=0" are added by Chrome\'s cache after extensions run, so no extension can remove them. They only appear when you revisit or reload a page; clear your cache or open the test in a fresh window to avoid them.'
  },
  {
    id: 'webgl',
    name: 'WebGL & Graphics Card',
    shortSummary: 'Your exact graphics card model and its hardware limits.',
    whatItReveals:
      'The GPU vendor and model string (for example "NVIDIA GeForce RTX 3060"), dozens of hardware limits, supported extensions and the pixels of 3D scenes. WebGPU can also reveal the GPU architecture.',
    whyItMatters:
      'GPU strings and limits vary a lot between machines and are often unique when combined. A made-up name like "Generic GPU" backfires, because no real computer reports it.',
    howMitigationWorks:
      'Reports a very common real GPU from the same brand as yours, caps hardware limits at common values, hides rare extensions and adds invisible noise to read-back 3D images.',
    siteImpact: 'Low: 3D sites still work. Very advanced WebGL apps may lose rare features.',
    cantHide:
      'WebGL parameters and the extension list come from your browser version and real graphics hardware. PrintShield caps the limits and hides rare extensions, but it cannot add features your GPU lacks, so this can stay uncommon. "WebGL Data" is a rendered image, randomized like canvas, so test sites list it as unique even though it cannot be linked. No public dataset gives exact GPU shares, so PrintShield reports the most widespread Intel laptop GPU without its model-specific device ID.'
  },
  {
    id: 'screen',
    name: 'Screen Size & Position',
    shortSummary: 'Monitor resolution, usable area, color depth and window position.',
    whatItReveals:
      'Screen width and height, the area left after your taskbar, color depth, where your window sits on the desktop, and media queries for the device size.',
    whyItMatters:
      'An uncommon resolution (like 1680×1050) or an unusual taskbar height can be shared by under 1% of users. Window position can reveal a multi-monitor setup.',
    howMitigationWorks:
      'Reports the smallest common resolution that fits your window (for example 1920×1080 with a standard taskbar), 24-bit color, and a window position of 0,0.',
    siteImpact: 'Very low: page layout uses the window size, which is unchanged.',
    cantHide:
      'Your browser window size is not changed, because pages need it for layout. A maximized window can still hint at your real usable screen area.'
  },
  {
    id: 'fonts',
    name: 'Installed Fonts',
    shortSummary: 'Fonts added by apps like Office or Adobe reveal your software.',
    whatItReveals:
      'Scripts measure text in hundreds of fonts; if the width changes, the font is installed. The list reveals installed software (Microsoft Office adds fonts like "Algerian" and "Agency FB"), languages and even your profession.',
    whyItMatters:
      'Font lists are one of the strongest identifiers. amiunique.org often finds a given font list shared by about 1% of browsers or fewer.',
    howMitigationWorks:
      'Shows the most common font list for your operating system (on Windows: Windows + Microsoft Office). Common fonts you lack are emulated and about 170 rarer fonts are hidden, so you match the largest crowd instead of standing out. Also blocks the font-list API and answers font checks the same way.',
    siteImpact: 'Low: a page asking for a hidden font shows a standard font instead. Web fonts that sites download still work.',
    cantHide:
      'No font list is shared by everyone. The most common Windows list is "Windows + Microsoft Office", so PrintShield shows exactly that: Office fonts you lack are emulated and every other extra font is hidden. Advanced scripts that inspect how a font draws, not just whether it exists, may still notice differences.'
  },
  {
    id: 'audio',
    name: 'Web Audio Processing',
    shortSummary: 'Silent sounds reveal tiny math differences in your audio stack.',
    whatItReveals:
      'A site generates a sound without playing it and reads back the samples. Your CPU, OS and browser audio code each produce slightly different numbers.',
    whyItMatters:
      'The resulting audio hash stays the same for your device and survives cookie clearing.',
    howMitigationWorks:
      'Adds inaudible noise (about one millionth of the signal) to rendered audio and frequency data. It stays consistent within a page but changes on every visit.',
    siteImpact: 'None: far below human hearing.',
    cantHide:
      'Like canvas, test sites show the audio value as unique because it changes on each visit, which is what makes it unlinkable. Your audio sample rate (44.1 or 48 kHz) comes from your sound hardware and is left as is.'
  },
  {
    id: 'timezone',
    name: 'Time Zone',
    shortSummary: 'Your time zone narrows down where you live.',
    whatItReveals:
      'JavaScript dates report your time-zone offset (for example UTC-05:00) and name (for example America/New_York).',
    whyItMatters:
      'Combined with language, it places you in a region, and many zones are shared by only ~5% of users. It also exposes VPN users whose time zone does not match their IP address.',
    howMitigationWorks:
      'Reports the most widely used time-zone name that runs exactly the same clock as yours (for example America/Detroit or America/Toronto become America/New_York). Your clock is unchanged, so this costs nothing.',
    siteImpact: 'None: every time shown on sites stays correct.',
    cantHide:
      'Your UTC offset (for example UTC-05:00) stays visible: changing it would make every clock on the web wrong, and your IP address reveals your region anyway. Pretending to be in UTC was tested: common on amiunique.org (about 21%) but rare on Cover Your Tracks (1 in 91), where most UTC visitors are servers or Tor users.'
  },
  {
    id: 'battery',
    name: 'Battery Status',
    shortSummary: 'Your exact battery level and charging state.',
    whatItReveals:
      'The battery API shows your charge level (for example 60%), whether you are charging, and the time remaining.',
    whyItMatters:
      'Battery values change slowly, so for a few minutes they can link your visits across different sites, even in private mode. amiunique.org found the combination can be rarer than 0.1%.',
    howMitigationWorks: 'Always reports a plugged-in, fully charged device, the most common desktop answer.',
    siteImpact: 'None for nearly all sites.',
    cantHide:
      'Nothing important. Desktop computers without a battery already report a full, charging battery.'
  },
  {
    id: 'network',
    name: 'Network Connection',
    shortSummary: 'Estimated connection speed, latency and data-saver setting.',
    whatItReveals:
      'The connection API reports your connection type (such as 4g), download speed, round-trip time and whether Data Saver is on.',
    whyItMatters:
      'These values depend on your internet provider and location. Combined, they add several bits of identifying information.',
    howMitigationWorks: 'Reports the most common values: 4g, 10 Mbps, 50 ms, Data Saver off.',
    siteImpact: 'Very low: video sites may tune quality a little less precisely.',
    cantHide:
      'Your IP address and your real connection speed are still visible to servers. This only changes what page scripts can read.'
  },
  {
    id: 'devices',
    name: 'Keyboard & Media Devices',
    shortSummary: 'Keyboard layout, cameras, microphones and permission settings.',
    whatItReveals:
      'Your keyboard layout (which hints at language and region), how many cameras, microphones and speakers you have, and how you have set site permissions.',
    whyItMatters:
      'A non-US keyboard layout or unusual device count is rare. amiunique.org found keyboard layout values shared by only ~6% of users.',
    howMitigationWorks:
      'Reports a US QWERTY layout and one microphone, one camera and one speaker until you allow a site to use your camera or mic. Permission checks are shown for awareness only, since default settings are the same for most people.',
    siteImpact: 'Low: games that show key labels may display US labels.',
    cantHide:
      'Permission states (for example camera: prompt) are left alone, because the defaults are what most people have. If you actually type on a page, scripts can still see which characters your keys produce.'
  }
];

const VECTOR_NAMES = Object.fromEntries(VECTORS_METADATA.map((m) => [m.id, m.name]));

let currentTabId = null;
let currentTabUrl = '';
let currentWeights = {};
const expandedTooltips = new Set();
let pendingRefresh = null;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isWebPage(url) {
  return /^(https?|file):/.test(url || '');
}

function updateScoreUI(score) {
  const scoreValueEl = document.getElementById('score-value');
  const ringFillEl = document.getElementById('metric-ring-progress');
  const badgeEl = document.getElementById('protection-badge');
  const descEl = document.getElementById('metric-explanation');

  scoreValueEl.textContent = String(score);
  const circumference = 219.91; // 2 * PI * 35
  ringFillEl.style.strokeDashoffset = String(circumference - (score / 100) * circumference);

  badgeEl.classList.remove('status-low', 'status-medium', 'status-high');
  if (score >= 75) {
    ringFillEl.style.stroke = '#10b981';
    badgeEl.classList.add('status-high');
    badgeEl.textContent = 'Strong Shield';
    descEl.textContent = 'Your browser reports common values, so it blends in with a large crowd of other browsers.';
  } else if (score >= 35) {
    ringFillEl.style.stroke = '#f59e0b';
    badgeEl.classList.add('status-medium');
    badgeEl.textContent = 'Partial Shield';
    descEl.textContent = 'Some vectors are protected, but the unprotected ones can still be combined into a unique ID.';
  } else {
    ringFillEl.style.stroke = '#f43f5e';
    badgeEl.classList.add('status-low');
    badgeEl.textContent = 'High Exposure';
    descEl.textContent = 'Websites can combine your hardware, fonts and settings into an ID that follows you without cookies.';
  }
}

function statusFor(meta, vState, isProtected, onWebPage) {
  if (meta.passive) {
    if (!onWebPage) return { cls: 'activity-idle', label: 'Passive' };
    return isProtected
      ? { cls: 'activity-protected', label: 'Sent · generalized' }
      : { cls: 'activity-detected', label: 'Sent with every request' };
  }
  const isDetected = vState.count > 0;
  if (isDetected && isProtected) return { cls: 'activity-protected', label: `Read & masked (${vState.count})` };
  if (isDetected) return { cls: 'activity-detected', label: `Read by page (${vState.count})` };
  if (isProtected) return { cls: 'activity-protected', label: 'Protected' };
  return { cls: 'activity-idle', label: 'Not read yet' };
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
      liveReadout = '<div class="live-api-readout">Headers are sent automatically with every request, so this page\'s server has already received them.</div>';
    } else if (vState.lastApi) {
      liveReadout = `<div class="live-api-readout">
          <div><strong>Latest:</strong> ${escapeHtml(vState.detail)}${vState.frame ? ` <span class="frame-chip">in ${escapeHtml(vState.frame)}</span>` : ''}</div>
          ${apiList ? `<ul class="api-list">${apiList}</ul>` : ''}
        </div>`;
    } else {
      liveReadout = '<div class="live-api-readout">This page has not read this fingerprint yet. Open "Test Lab" above to see it live!</div>';
    }

    const tags = [
      meta.priority ? '<span class="priority-tag">Core</span>' : '',
      meta.passive ? '<span class="priority-tag passive-tag">Passive</span>' : '',
      meta.optIn ? '<span class="priority-tag optin-tag">Opt-in</span>' : ''
    ].join('');

    return `
      <div class="vector-card ${meta.priority ? 'focus-vector' : ''} ${isProtected ? 'mitigated-card' : ''} ${
        !isProtected && vState.count > 0 ? 'exposed-card' : ''}">
        <div class="vector-top">
          <div class="vector-title-group">
            <span class="vector-name">${escapeHtml(meta.name)}</span>
            ${tags}
          </div>
          <label class="switch" title="Toggle ${escapeHtml(meta.name)} protection (+${weight}% score)">
            <input type="checkbox" data-vector="${meta.id}" ${isProtected ? 'checked' : ''} aria-label="Protect ${escapeHtml(meta.name)}">
            <span class="slider"></span>
          </label>
        </div>
        <div class="vector-subrow">
          <span class="activity-badge ${status.cls}">${escapeHtml(status.label)}</span>
          <button type="button" class="tooltip-trigger" data-tooltip-btn="${meta.id}" aria-expanded="${isExpanded}">
            ${isExpanded ? 'Hide info ▲' : 'Why this matters ▼'}
          </button>
        </div>
        <div class="vector-summary">${escapeHtml(meta.shortSummary)}</div>
        <div class="vector-tooltip" id="tooltip-${meta.id}" ${isExpanded ? '' : 'hidden'}>
          <div class="tooltip-section">
            <span class="tooltip-heading">🔍 What trackers learn</span>
            <span>${escapeHtml(meta.whatItReveals)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">⚠️ Why it makes you unique</span>
            <span>${escapeHtml(meta.whyItMatters)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">🛡️ How PrintShield protects you (+${weight}%)</span>
            <span>${escapeHtml(meta.howMitigationWorks)}</span>
          </div>
          <div class="tooltip-section">
            <span class="tooltip-heading">⚖️ Site compatibility</span>
            <span>${escapeHtml(meta.siteImpact)}</span>
          </div>
          ${meta.cantHide ? `<div class="tooltip-section limits-section">
            <span class="tooltip-heading">🚧 What PrintShield can't hide</span>
            <span>${escapeHtml(meta.cantHide)}</span>
          </div>` : ''}
          ${liveReadout}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
  const total = VECTORS_METADATA.filter((m) => !m.passive).length;
  detectedSummary.textContent = `${activeCount} of ${total} read on this page`;

  const alertEl = document.getElementById('page-alert');
  if (exposedCount > 0) {
    alertEl.hidden = false;
    alertEl.removeAttribute('data-ok');
    alertEl.textContent = `⚠️ This page read ${exposedCount} fingerprint type${exposedCount === 1 ? '' : 's'} you have not protected yet.`;
  } else if (activeCount > 0) {
    alertEl.hidden = false;
    alertEl.setAttribute('data-ok', '');
    alertEl.textContent = `✅ This page read ${activeCount} fingerprint type${activeCount === 1 ? '' : 's'}, and all of them were masked.`;
  } else {
    alertEl.hidden = true;
  }

  container.querySelectorAll('input[type="checkbox"][data-vector]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
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
      btn.textContent = open ? 'Hide info ▲' : 'Why this matters ▼';
      btn.setAttribute('aria-expanded', String(open));
    });
  });
}

function renderActivityFeed(tabData) {
  const feed = document.getElementById('activity-feed');
  const events = (tabData?.recentEvents || []).slice(0, 12);
  if (events.length === 0) {
    feed.innerHTML = '<li class="feed-empty">No fingerprinting activity recorded on this page yet.</li>';
    return;
  }
  feed.innerHTML = events.map((ev) => {
    const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<li class="feed-item ${ev.mitigated ? 'feed-masked' : 'feed-exposed'}">
        <span class="feed-dot" aria-hidden="true"></span>
        <div class="feed-body">
          <div class="feed-title">${escapeHtml(VECTOR_NAMES[ev.vector] || ev.vector)}
            <span class="feed-state">${ev.mitigated ? 'masked' : 'exposed'}</span>
            ${ev.count > 1 ? `<span class="feed-count">×${ev.count}</span>` : ''}
          </div>
          <div class="feed-detail">${escapeHtml(ev.detail)}${ev.frame ? ` <span class="frame-chip">in ${escapeHtml(ev.frame)}</span>` : ''}</div>
        </div>
        <span class="feed-time">${escapeHtml(time)}</span>
      </li>`;
  }).join('');
}

async function setMitigation(vector, enabled) {
  const response = await chrome.runtime.sendMessage({ type: 'SET_MITIGATION', vector, enabled, tabId: currentTabId });
  if (response && response.ok) {
    updateScoreUI(response.score);
    document.getElementById('reload-notice').hidden = !isWebPage(currentTabUrl);
    await refreshDashboard();
  }
}

async function refreshDashboard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;
  currentTabUrl = tab.url || '';

  const domainEl = document.getElementById('active-domain');
  try {
    const urlObj = new URL(currentTabUrl);
    domainEl.textContent = `Active page: ${urlObj.hostname || tab.title || 'local file'}`;
  } catch {
    domainEl.textContent = `Active page: ${tab.title || 'browser tab'}`;
  }

  const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', tabId: tab.id, url: tab.url });
  if (response && response.ok) {
    currentWeights = response.weights || {};
    updateScoreUI(response.score);
    renderVectorsList(response.tabData, response.mitigations);
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

document.addEventListener('DOMContentLoaded', async () => {
  await refreshDashboard();

  document.getElementById('protect-all-btn').addEventListener('click', () => setMitigation('RECOMMENDED', true));
  document.getElementById('reset-all-btn').addEventListener('click', () => setMitigation('ALL', false));
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
