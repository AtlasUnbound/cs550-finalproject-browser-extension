/**
 * PrintShield — Interactive Study Test Lab Script
 * Simulates real-world fingerprinting scripts so study participants can
 * observe detection and mitigation behavior in real time.
 */

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

function getActiveConfig() {
  try {
    return JSON.parse(document.documentElement.dataset.printshieldConfig || '{}');
  } catch {
    return {};
  }
}

function runCanvasProbe() {
  const canvas = document.getElementById('fp-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Typical fingerprinting scene: gradient + overlapping fonts + arc + emoji
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

  // Extract data URL (triggers HTMLCanvasElement.prototype.toDataURL hook)
  const dataUrl = canvas.toDataURL();
  const hash = computeSimpleHash(dataUrl);

  const cfg = getActiveConfig();
  document.getElementById('canvas-hash-out').textContent = `0x${hash}`;
  document.getElementById('canvas-status-out').textContent = cfg.canvas
    ? '🛡️ Mitigated (Session Noise Injected)'
    : '⚠️ Raw Hardware Canvas Signature Exposed';
}

function runNavigatorProbe() {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  const cores = navigator.hardwareConcurrency || 'N/A';
  const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'N/A';
  const langs = (navigator.languages || [navigator.language]).join(', ');

  document.getElementById('ua-string-out').textContent = ua;
  document.getElementById('ua-platform-out').textContent = platform;
  document.getElementById('ua-hw-out').textContent = `${cores} Logical Cores / ${mem} RAM`;
  document.getElementById('ua-lang-out').textContent = langs;
}

function runWebGLProbe() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    document.getElementById('webgl-vendor-out').textContent = 'WebGL unavailable';
    return;
  }
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);

  document.getElementById('webgl-vendor-out').textContent = String(vendor);
  document.getElementById('webgl-renderer-out').textContent = String(renderer);
}

function runAudioAndFontProbe() {
  // 1. Web Audio Buffer probe
  try {
    const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx(1, 4410, 44100);
      const buffer = ctx.createBuffer(1, 256, 44100);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        ch[i] = Math.sin(i * 0.15) * 0.5;
      }
      // Read channel data again to trigger AudioBuffer.prototype.getChannelData hook
      const outData = buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < outData.length; i++) {
        sum += Math.abs(outData[i]);
      }
      document.getElementById('audio-hash-out').textContent = sum.toFixed(8);
    }
  } catch (err) {
    document.getElementById('audio-hash-out').textContent = 'Audio API blocked';
  }

  // 2. Font Metrics probe
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const testFonts = ['Arial', 'Courier New', 'Georgia', 'Calibri', 'Consolas'];
  const widths = testFonts.map((f) => {
    ctx.font = `16px "${f}", monospace`;
    return `${f}:${ctx.measureText('mmmmmmmmmmlli').width.toFixed(2)}`;
  });
  document.getElementById('font-metrics-out').textContent = widths.join(' | ');
}

function runAllProbes() {
  runCanvasProbe();
  runNavigatorProbe();
  runWebGLProbe();
  runAudioAndFontProbe();
}

document.addEventListener('DOMContentLoaded', () => {
  // Wait briefly for protector-main.js to finish attaching on initial load
  setTimeout(runAllProbes, 120);

  document.getElementById('run-all-probes').addEventListener('click', runAllProbes);
  document.getElementById('probe-canvas-btn').addEventListener('click', runCanvasProbe);
  document.getElementById('probe-ua-btn').addEventListener('click', runNavigatorProbe);
  document.getElementById('probe-webgl-btn').addEventListener('click', runWebGLProbe);
  document.getElementById('probe-other-btn').addEventListener('click', runAudioAndFontProbe);
});
