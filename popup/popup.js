/**
 * PrintShield — Popup Dashboard Controller
 * Implements:
 * - Visual Privacy Protection Metric (SVG progress ring + status classification)
 * - 5 Fingerprinting Vectors with special emphasis on Canvas 2D & User-Agent/Navigator
 * - Educational Tooltips for Study Task 2 ("Understanding Fingerprints")
 * - Real-time Mitigation Toggles for Study Task 3 ("Mitigation Testing")
 */

const VECTORS_METADATA = [
  {
    id: 'canvas',
    name: 'Canvas 2D Rendering',
    priority: true,
    weight: 30,
    shortSummary: 'Hidden images drawn to measure GPU & font rendering quirks.',
    whatItReveals:
      'Your exact graphics card model, OS font anti-aliasing settings, and GPU driver version. Even identical laptops can render microscopic pixel differences.',
    howMitigationWorks:
      'Injects subtle, invisible session noise into exported canvas pixel buffers (toDataURL & getImageData) so trackers cannot lock onto a permanent hash.',
    siteImpact: 'Very Low — normal images and games look identical to the human eye.'
  },
  {
    id: 'userAgent',
    name: 'User-Agent & Navigator',
    priority: true,
    weight: 30,
    shortSummary: 'Browser identity, OS platform, CPU core count, and RAM size.',
    whatItReveals:
      'Your operating system (e.g., Windows 11 64-bit), exact Chrome build, number of logical CPU cores (hardwareConcurrency), device memory (RAM in GB), and system language.',
    howMitigationWorks:
      'Generalizes navigator properties to standard, common desktop values (Windows 10, 4 cores, 8 GB RAM, en-US) so your device blends into a larger crowd.',
    siteImpact: 'Low — sites still serve desktop layouts without knowing your exact hardware specs.'
  },
  {
    id: 'webgl',
    name: 'WebGL & GPU Hardware',
    priority: false,
    weight: 15,
    shortSummary: 'Direct3D / OpenGL graphics hardware vendor and renderer strings.',
    whatItReveals:
      'Unmasked GPU strings (e.g., "NVIDIA GeForce RTX..." or "ANGLE Intel Iris Xe") and shader precision capabilities.',
    howMitigationWorks:
      'Masks WebGL UNMASKED_VENDOR and UNMASKED_RENDERER parameters with a generic ANGLE Direct3D11 identifier.',
    siteImpact: 'Low — 3D graphics still render, though hardware diagnostic sites see a generic GPU.'
  },
  {
    id: 'audio',
    name: 'Web Audio Context',
    priority: false,
    weight: 15,
    shortSummary: 'Silent audio oscillators used to profile audio stack math.',
    whatItReveals:
      'Tiny floating-point variations in how your sound card and OS audio pipeline process sound waves and frequency filters.',
    howMitigationWorks:
      'Adds imperceptible floating-point jitter (10⁻⁷ magnitude) to AudioBuffer waveforms so the acoustic hash changes every session.',
    siteImpact: 'None — completely inaudible during video or music playback.'
  },
  {
    id: 'fonts',
    name: 'Font Enumeration & Metrics',
    priority: false,
    weight: 10,
    shortSummary: 'Bounding-box measurements used to deduce installed system fonts.',
    whatItReveals:
      'Whether you have specific developer, Adobe, Microsoft Office, or language packs installed by measuring text widths across hundreds of font families.',
    howMitigationWorks:
      'Rounds sub-pixel text measurement widths and restricts document.fonts.check() responses to standard web-safe fonts.',
    siteImpact: 'Low — occasionally minor text kerning adjustments on canvas-heavy text editors.'
  }
];

let currentTabId = null;
let currentMitigations = {
  canvas: false,
  userAgent: false,
  audio: false,
  webgl: false,
  fonts: false
};
let expandedTooltips = new Set(['canvas', 'userAgent']); // Pre-expand priority vectors on first view

function updateScoreUI(score) {
  const scoreValueEl = document.getElementById('score-value');
  const ringFillEl = document.getElementById('metric-ring-progress');
  const badgeEl = document.getElementById('protection-badge');
  const descEl = document.getElementById('metric-explanation');

  scoreValueEl.textContent = String(score);

  // Circumference = 2 * PI * 35 ≈ 219.91
  const circumference = 219.91;
  const offset = circumference - (score / 100) * circumference;
  ringFillEl.style.strokeDashoffset = String(offset);

  badgeEl.classList.remove('status-low', 'status-medium', 'status-high');

  if (score >= 75) {
    ringFillEl.style.stroke = '#10b981';
    badgeEl.classList.add('status-high');
    badgeEl.textContent = 'Strong Shield';
    descEl.textContent =
      'Key hardware & rendering vectors are generalized or randomized. Your browser blends in with common devices.';
  } else if (score >= 35) {
    ringFillEl.style.stroke = '#f59e0b';
    badgeEl.classList.add('status-medium');
    badgeEl.textContent = 'Partial Shield';
    descEl.textContent =
      'Some fingerprinting vectors are mitigated, but unmasked vectors can still be combined to track you.';
  } else {
    ringFillEl.style.stroke = '#f43f5e';
    badgeEl.classList.add('status-low');
    badgeEl.textContent = 'High Exposure';
    descEl.textContent =
      'Your browser currently shares unique Canvas and Navigator hardware signatures with websites.';
  }
}

function renderVectorsList(tabData, mitigations) {
  const container = document.getElementById('vectors-container');
  const detectedSummary = document.getElementById('detected-summary');
  container.innerHTML = '';

  const vectorsState = tabData?.vectors || {};
  let activeVectorCount = 0;

  VECTORS_METADATA.forEach((meta) => {
    const vState = vectorsState[meta.id] || { count: 0, lastApi: '', detail: '' };
    const isProtected = Boolean(mitigations[meta.id]);
    const isDetected = vState.count > 0;
    if (isDetected) activeVectorCount++;

    const card = document.createElement('div');
    card.className = `vector-card ${meta.priority ? 'focus-vector' : ''} ${
      isProtected ? 'mitigated-card' : ''
    }`;

    let statusClass = 'activity-idle';
    let statusLabel = 'No calls yet';
    if (isDetected && isProtected) {
      statusClass = 'activity-protected';
      statusLabel = `Spoofed (${vState.count})`;
    } else if (isDetected && !isProtected) {
      statusClass = 'activity-detected';
      statusLabel = `Exposed (${vState.count})`;
    } else if (!isDetected && isProtected) {
      statusClass = 'activity-protected';
      statusLabel = 'Protected';
    }

    const isExpanded = expandedTooltips.has(meta.id);

    card.innerHTML = `
      <div class="vector-top">
        <div class="vector-title-group">
          <span class="vector-name">${meta.name}</span>
          ${meta.priority ? '<span class="priority-tag">Core Vector</span>' : ''}
          <span class="activity-badge ${statusClass}">${statusLabel}</span>
        </div>
        <label class="switch" title="Toggle ${meta.name} protection (+${meta.weight}% privacy score)">
          <input type="checkbox" data-vector="${meta.id}" ${isProtected ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="vector-subrow">
        <span class="vector-summary">${meta.shortSummary}</span>
        <button type="button" class="tooltip-trigger" data-tooltip-btn="${meta.id}" aria-expanded="${isExpanded}">
          ${isExpanded ? 'Hide info ▲' : 'Why this matters ▼'}
        </button>
      </div>
      <div class="vector-tooltip" id="tooltip-${meta.id}" ${isExpanded ? '' : 'hidden'}>
        <div class="tooltip-section">
          <span class="tooltip-heading">🔍 What Trackers Learn:</span>
          <span>${meta.whatItReveals}</span>
        </div>
        <div class="tooltip-section">
          <span class="tooltip-heading">🛡️ How PrintShield Protects You (+${meta.weight}%):</span>
          <span>${meta.howMitigationWorks}</span>
        </div>
        <div class="tooltip-section">
          <span class="tooltip-heading">⚖️ Site Compatibility:</span>
          <span>${meta.siteImpact}</span>
        </div>
        ${
          vState.lastApi
            ? `<div class="live-api-readout">Latest Page Call: ${vState.lastApi} — ${vState.detail}</div>`
            : `<div class="live-api-readout">No active calls detected on this tab yet. Open "Test Lab" above to see it live!</div>`
        }
      </div>
    `;

    container.appendChild(card);
  });

  detectedSummary.textContent = `${activeVectorCount} of 5 active on page`;

  // Attach toggle listeners
  container.querySelectorAll('input[type="checkbox"][data-vector]').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      const vector = e.target.getAttribute('data-vector');
      const enabled = e.target.checked;
      await setMitigation(vector, enabled);
    });
  });

  // Attach tooltip drawer listeners
  container.querySelectorAll('button[data-tooltip-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tooltip-btn');
      const drawer = document.getElementById(`tooltip-${id}`);
      if (!drawer) return;
      if (expandedTooltips.has(id)) {
        expandedTooltips.delete(id);
        drawer.hidden = true;
        btn.textContent = 'Why this matters ▼';
        btn.setAttribute('aria-expanded', 'false');
      } else {
        expandedTooltips.add(id);
        drawer.hidden = false;
        btn.textContent = 'Hide info ▲';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

async function setMitigation(vector, enabled) {
  const response = await chrome.runtime.sendMessage({
    type: 'SET_MITIGATION',
    vector,
    enabled,
    tabId: currentTabId
  });
  if (response && response.ok) {
    currentMitigations = response.mitigations;
    updateScoreUI(response.score);
    document.getElementById('reload-notice').hidden = false;
    await refreshDashboard();
  }
}

async function refreshDashboard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  const domainEl = document.getElementById('active-domain');
  try {
    const urlObj = new URL(tab.url || '');
    domainEl.textContent = `Active Page: ${urlObj.hostname || tab.title || 'Local Tab'}`;
  } catch {
    domainEl.textContent = `Active Page: ${tab.title || 'Browser Tab'}`;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_STATUS',
    tabId: tab.id,
    url: tab.url
  });

  if (response && response.ok) {
    currentMitigations = response.mitigations;
    updateScoreUI(response.score);
    renderVectorsList(response.tabData, response.mitigations);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await refreshDashboard();

  document.getElementById('protect-all-btn').addEventListener('click', async () => {
    await setMitigation('ALL', true);
  });

  document.getElementById('reset-all-btn').addEventListener('click', async () => {
    await setMitigation('ALL', false);
  });

  document.getElementById('open-sandbox-btn').addEventListener('click', async () => {
    const url = chrome.runtime.getURL('sandbox/test-lab.html');
    await chrome.tabs.create({ url });
  });
});
