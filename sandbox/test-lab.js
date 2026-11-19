/**
 * PrintShield — Interactive Study Test Lab Script
 * Simulates real-world fingerprinting scripts (modeled on amiunique.org and
 * FingerprintJS) so study participants can watch detection and mitigation live.
 */

const results = {}; // probe name -> string used for the combined fingerprint ID
let currentMitigations = {};

function computeSimpleHash(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

const $ = (id) => document.getElementById(id);
const setText = (id, text) => { $(id).textContent = text; };

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
function drawFingerprintScene(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 280, 0);
  grad.addColorStop(0, '#f60');
  grad.addColorStop(0.5, '#069');
  grad.addColorStop(1, '#10b981');
  ctx.fillStyle = grad;
  ctx.fillRect(8, 8, 264, 44);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '15px "Arial", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('PrintShield CS-550 Fingerprint 🛡️', 16, 32);
  ctx.font = '12px "Courier New", monospace';
  ctx.fillStyle = 'rgba(255, 255, 180, 0.9)';
  ctx.fillText('Cwm fjordbank glyphs vext quiz', 16, 47);
  ctx.beginPath();
  ctx.arc(250, 30, 14, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255, 0, 255, 0.5)';
  ctx.fill();
}

function runCanvasProbe() {
  const canvas = $('fp-canvas');
  drawFingerprintScene(canvas);
  const first = computeSimpleHash(canvas.toDataURL());
  const second = computeSimpleHash(canvas.toDataURL());
  results.canvas = first;
  setText('canvas-hash-out', `0x${first}`);
  setText('canvas-stable-out', first === second
    ? 'Yes (scripts cannot tell noise is being added)'
    : 'No — values changed between reads');
  setText('canvas-status-out', currentMitigations.canvas
    ? '🛡️ Protected: the code changes on every visit'
    : '⚠️ Not protected: the same code every visit identifies your computer');
}

// ---------------------------------------------------------------------------
// Navigator
// ---------------------------------------------------------------------------
async function runNavigatorProbe() {
  const cores = navigator.hardwareConcurrency || 'N/A';
  const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'N/A';
  const langs = (navigator.languages || [navigator.language]).join(', ');
  const props = [];
  for (const key in navigator) props.push(key); // eslint-disable-line guard-for-in

  setText('ua-string-out', navigator.userAgent);
  setText('ua-platform-out', navigator.platform);
  setText('ua-hw-out', `${cores} logical cores / ${mem} RAM`);
  setText('ua-lang-out', langs);
  setText('ua-props-out', `${props.length} properties`);
  setText('headers-lang-out', `Accept-Language: ${langs.split(', ').map((l, i) => (i ? `${l};q=${(1 - i / 10).toFixed(1)}` : l)).join(',')}`);

  let hints = 'Client Hints unavailable';
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try {
      const h = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion']);
      hints = `${h.platform} ${h.platformVersion} · ${h.architecture}/${h.bitness}-bit · Chrome ${h.uaFullVersion}`;
    } catch {
      hints = 'Blocked';
    }
  }
  setText('ua-hints-out', hints);
  results.navigator = [navigator.userAgent, navigator.platform, cores, mem, langs, props.length, hints].join('|');
}

// ---------------------------------------------------------------------------
// WebGL
// ---------------------------------------------------------------------------
function runWebGLProbe() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    setText('webgl-vendor-out', 'WebGL unavailable');
    results.webgl = 'none';
    return;
  }
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const extensions = gl.getSupportedExtensions() || [];
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const viewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || []).join('×');

  setText('webgl-vendor-out', String(vendor));
  setText('webgl-renderer-out', String(renderer));
  setText('webgl-params-out', `${extensions.length} extensions · max texture ${maxTex} · viewport ${viewport}`);
  results.webgl = [vendor, renderer, extensions.join(','), maxTex, viewport].join('|');
}

// ---------------------------------------------------------------------------
// Fonts (DOM width/height probing, like amiunique.org)
// ---------------------------------------------------------------------------
const PROBE_FONTS = [
  // Ship with Windows / macOS (everyone on that OS has them)
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Helvetica Neue', 'Menlo', 'Monaco',
  // Added by Microsoft Office, Adobe, developer tools, Linux distros…
  'Agency FB', 'Algerian', 'Bauhaus 93', 'Bodoni MT', 'Book Antiqua', 'Bookman Old Style', 'Britannic Bold', 'Broadway',
  'Century Gothic', 'Chiller', 'Colonna MT', 'Cooper Black', 'Curlz MT', 'Elephant', 'Forte', 'Garamond', 'Gill Sans MT',
  'Goudy Old Style', 'Haettenschweiler', 'Harrington', 'Jokerman', 'Lucida Bright', 'Magneto', 'Mistral',
  'Monotype Corsiva', 'Papyrus', 'Playbill', 'Rockwell', 'Stencil', 'Tw Cen MT', 'Wide Latin', 'Cascadia Code',
  'Myriad Pro', 'Minion Pro', 'Ubuntu', 'DejaVu Sans'
];

function runFontProbe() {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
  document.body.appendChild(holder);

  const makeSpan = (family) => {
    const span = document.createElement('span');
    span.style.fontSize = '72px';
    span.style.fontFamily = family;
    span.textContent = 'mmmmmmmmmmlli';
    holder.appendChild(span);
    return span;
  };

  const baseSize = {};
  baseFonts.forEach((base) => {
    const s = makeSpan(base);
    baseSize[base] = [s.offsetWidth, s.offsetHeight];
  });

  const detected = PROBE_FONTS.filter((font) => baseFonts.some((base) => {
    const s = makeSpan(`"${font}", ${base}`);
    return s.offsetWidth !== baseSize[base][0] || s.offsetHeight !== baseSize[base][1];
  }));
  holder.remove();

  setText('fonts-count-out', `${detected.length} of ${PROBE_FONTS.length} tested fonts`);
  const list = $('fonts-list-out');
  list.innerHTML = '';
  detected.forEach((font) => {
    const chip = document.createElement('span');
    chip.className = 'font-chip';
    chip.textContent = font;
    list.appendChild(chip);
  });
  results.fonts = detected.join(',');
}

// ---------------------------------------------------------------------------
// Audio (FingerprintJS-style OfflineAudioContext + compressor)
// ---------------------------------------------------------------------------
async function runAudioProbe() {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50;
    comp.knee.value = 40;
    comp.ratio.value = 12;
    comp.attack.value = 0;
    comp.release.value = 0.25;
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    setText('audio-hash-out', sum.toString());
    results.audio = sum.toString();
  } catch (err) {
    setText('audio-hash-out', 'Audio API blocked');
    results.audio = 'blocked';
  }
}

// ---------------------------------------------------------------------------
// Screen, time zone, battery, network, devices
// ---------------------------------------------------------------------------
function runScreenProbe() {
  const s = window.screen;
  setText('screen-size-out', `${s.width} × ${s.height}`);
  setText('screen-avail-out', `${s.availWidth} × ${s.availHeight} (top ${s.availTop}, left ${s.availLeft})`);
  setText('screen-misc-out', `${s.colorDepth}-bit · window at (${window.screenX}, ${window.screenY})`);
  results.screen = [s.width, s.height, s.availWidth, s.availHeight, s.colorDepth, window.screenX, window.screenY].join('|');
}

function runTimezoneProbe() {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const label = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  setText('tz-out', `${label} · ${name}`);
  setText('tz-time-out', new Date().toString());
  results.timezone = `${offset}|${name}`;
}

async function runBatteryNetworkProbe() {
  if (navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      setText('battery-out', `${Math.round(b.level * 100)}% · ${b.charging ? 'charging' : 'on battery'}`);
      results.battery = `${b.level}|${b.charging}`;
    } catch {
      setText('battery-out', 'Blocked');
    }
  } else {
    setText('battery-out', 'Battery API not available');
  }
  const c = navigator.connection;
  if (c) {
    setText('network-out', `${c.effectiveType} · ${c.downlink} Mbps · ${c.rtt} ms RTT · data saver ${c.saveData ? 'on' : 'off'}`);
    results.network = [c.effectiveType, c.downlink, c.rtt, c.saveData].join('|');
  } else {
    setText('network-out', 'Network Information API not available');
  }
}

async function runDevicesProbe() {
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    try {
      const map = await navigator.keyboard.getLayoutMap();
      const sample = ['KeyQ', 'KeyW', 'KeyY', 'KeyZ', 'Semicolon', 'BracketLeft'].map((k) => map.get(k) || '?').join(' ');
      setText('keyboard-out', `${map.size} keys · Q W Y Z ; [ → ${sample}`);
      results.keyboard = sample;
    } catch {
      setText('keyboard-out', 'Blocked (page not focused?)');
    }
  } else {
    setText('keyboard-out', 'Keyboard API not available');
  }
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const counts = {};
    devices.forEach((d) => { counts[d.kind] = (counts[d.kind] || 0) + 1; });
    const text = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none';
    setText('media-out', text);
    results.media = text;
  }
}

// ---------------------------------------------------------------------------
// Combined ID
// ---------------------------------------------------------------------------
function updateCombinedId() {
  const keys = Object.keys(results).sort();
  const id = computeSimpleHash(keys.map((k) => `${k}=${results[k]}`).join(';'));
  setText('combined-id-out', `0x${id}`);

  let previous = null;
  try {
    previous = localStorage.getItem('printshield-last-id');
    localStorage.setItem('printshield-last-id', id);
  } catch { /* storage unavailable */ }

  setText('previous-id-out', previous ? `0x${previous}` : '— (reload this page to compare)');
  if (!previous) {
    setText('linkable-out', 'Reload the page to compare visits');
  } else if (previous === id) {
    setText('linkable-out', '⚠️ Yes — same ID as last visit, so trackers can recognize you');
  } else {
    setText('linkable-out', '🛡️ No — the ID changed, so this visit cannot be linked to the last one');
  }
}

async function runAllProbes() {
  runCanvasProbe();
  runWebGLProbe();
  runFontProbe();
  runScreenProbe();
  runTimezoneProbe();
  await Promise.all([runNavigatorProbe(), runAudioProbe(), runBatteryNetworkProbe(), runDevicesProbe()]);
  updateCombinedId();
}

// ---------------------------------------------------------------------------
// Protection status + font shield (registered content CSS does not run on
// extension pages, so the Test Lab adds the same stylesheet itself)
// ---------------------------------------------------------------------------
async function applyFontShield(enabled) {
  let link = document.getElementById('printshield-font-shield');
  if (!enabled) {
    if (link) link.remove();
    return;
  }
  if (link) return;
  const { os } = await chrome.runtime.getPlatformInfo();
  const key = os === 'win' || os === 'mac' ? os : 'linux';
  link = document.createElement('link');
  link.id = 'printshield-font-shield';
  link.rel = 'stylesheet';
  link.href = `../content/fonts/font-shield-${key}.css`;
  await new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

function renderShieldStatus() {
  const on = Object.values(currentMitigations).filter(Boolean).length;
  const total = Object.keys(currentMitigations).length || 11;
  const chip = $('shield-status');
  chip.textContent = on ? `🛡️ ${on} of ${total} protections on` : '⚠️ No protections on';
  chip.classList.toggle('status-on', on > 0);
}

async function loadMitigations() {
  const { mitigations = {} } = await chrome.storage.local.get('mitigations');
  currentMitigations = mitigations;
  renderShieldStatus();
  await applyFontShield(Boolean(mitigations.fonts));
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.mitigations) {
    currentMitigations = changes.mitigations.newValue || {};
    renderShieldStatus();
    await applyFontShield(Boolean(currentMitigations.fonts));
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadMitigations();
  // Give bridge.js a moment to deliver the config to protector-main.js.
  setTimeout(runAllProbes, 250);

  $('run-all-probes').addEventListener('click', runAllProbes);
  $('probe-canvas-btn').addEventListener('click', () => { runCanvasProbe(); updateCombinedId(); });
  $('probe-ua-btn').addEventListener('click', async () => { await runNavigatorProbe(); updateCombinedId(); });
  $('probe-webgl-btn').addEventListener('click', () => { runWebGLProbe(); updateCombinedId(); });
  $('probe-fonts-btn').addEventListener('click', () => { runFontProbe(); updateCombinedId(); });
  $('probe-audio-btn').addEventListener('click', async () => { await runAudioProbe(); updateCombinedId(); });
  $('probe-screen-btn').addEventListener('click', () => { runScreenProbe(); updateCombinedId(); });
  $('probe-tz-btn').addEventListener('click', () => { runTimezoneProbe(); updateCombinedId(); });
  $('probe-battery-btn').addEventListener('click', async () => { await runBatteryNetworkProbe(); updateCombinedId(); });
  $('probe-devices-btn').addEventListener('click', async () => { await runDevicesProbe(); updateCombinedId(); });
});
