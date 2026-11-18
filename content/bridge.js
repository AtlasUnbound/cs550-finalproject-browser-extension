/**
 * PrintShield — Content Script Bridge (Isolated World)
 *
 * 1. Opens a private channel with protector-main.js (MAIN world). The channel's
 *    event names contain a random nonce exchanged through a DOM attribute before
 *    any page script runs, so a web page cannot forge messages (for example, to
 *    switch protections off) or eavesdrop on detections.
 * 2. Pushes the user's mitigation settings to the page live when they change.
 * 3. Forwards batched fingerprint detections to the background service worker.
 *
 * Also loaded as a plain <script> by sandbox/test-lab.html, where it plays the
 * same role for the Test Lab page.
 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

  const HANDSHAKE_ATTR = 'data-printshield-handshake';
  const root = document.documentElement;
  if (!root) return;

  function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Whichever side runs first writes the nonce; the other consumes it.
  let nonce = root.getAttribute(HANDSHAKE_ATTR);
  if (nonce) {
    root.removeAttribute(HANDSHAKE_ATTR);
  } else {
    nonce = randomHex(16);
    root.setAttribute(HANDSHAKE_ATTR, nonce);
    // Safety net: if the main-world script never runs here, remove the nonce.
    document.addEventListener('DOMContentLoaded', () => {
      if (root.getAttribute(HANDSHAKE_ATTR) === nonce) root.removeAttribute(HANDSHAKE_ATTR);
    }, { once: true });
  }

  const OUT_EVENT = `printshield-${nonce}-out`; // main world -> bridge
  const IN_EVENT = `printshield-${nonce}-in`;   // bridge -> main world
  const isTopFrame = window === window.top;

  function pushConfig(mitigations) {
    if (!mitigations) return;
    document.dispatchEvent(new CustomEvent(IN_EVENT, {
      detail: JSON.stringify({ type: 'config', mitigations })
    }));
  }

  function sendStoredConfig() {
    chrome.storage.local.get('mitigations').then(({ mitigations }) => pushConfig(mitigations)).catch(() => {});
  }
  sendStoredConfig();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.mitigations) pushConfig(changes.mitigations.newValue);
  });

  function frameLabel() {
    try {
      if (location.protocol === 'about:' || location.protocol === 'blob:' || location.protocol === 'data:') return 'embedded frame';
      return location.hostname || location.protocol.replace(':', '');
    } catch (e) {
      return 'frame';
    }
  }

  document.addEventListener(OUT_EVENT, (event) => {
    let msg;
    try {
      msg = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    if (msg && msg.type === 'ready') {
      sendStoredConfig();
      return;
    }
    if (!msg || msg.type !== 'detections' || !Array.isArray(msg.events) || msg.events.length === 0) return;
    try {
      chrome.runtime.sendMessage({
        type: 'RECORD_FINGERPRINT_EVENTS',
        events: msg.events.slice(0, 200),
        frame: isTopFrame ? null : frameLabel()
      }).catch(() => {});
    } catch (e) {
      // Extension was reloaded/updated: this page's bridge is orphaned.
    }
  });
})();
