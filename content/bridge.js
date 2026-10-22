/**
 * PrintShield — Content Script Bridge (Isolated World)
 * 1. Injects protector-main.js into the page's MAIN world at document_start
 * 2. Syncs user mitigation settings from chrome.storage.local to the page
 * 3. Forwards detected fingerprinting calls to the background service worker
 */
(function () {
  const DEFAULT_MITIGATIONS = {
    canvas: false,
    userAgent: false,
    audio: false,
    webgl: false,
    fonts: false
  };

  // Inject the main-world script immediately so APIs are wrapped before page scripts run
  function injectMainProtector(initialConfig) {
    try {
      const root = document.documentElement || document.head || document;
      if (document.documentElement) {
        document.documentElement.dataset.printshieldConfig = JSON.stringify(initialConfig);
      }
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/protector-main.js');
      script.onload = () => script.remove();
      root.appendChild(script);
    } catch (err) {
      // Ignore injection failure on restricted chrome:// or about: pages
    }
  }

  // Load saved mitigations and push updates to main world
  async function initConfig() {
    try {
      // Inject immediately with defaults, then push stored config as soon as promise resolves
      injectMainProtector(DEFAULT_MITIGATIONS);
      const { mitigations = DEFAULT_MITIGATIONS } = await chrome.storage.local.get('mitigations');
      if (document.documentElement) {
        document.documentElement.dataset.printshieldConfig = JSON.stringify(mitigations);
      }
      window.postMessage(
        {
          source: 'PRINTSHIELD_BRIDGE',
          type: 'UPDATE_CONFIG',
          mitigations
        },
        '*'
      );
    } catch (err) {
      // Extension context may be invalidated during reload
    }
  }

  initConfig();

  // Listen for live toggle changes from the popup
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.mitigations) {
      const newMitigations = changes.mitigations.newValue || DEFAULT_MITIGATIONS;
      if (document.documentElement) {
        document.documentElement.dataset.printshieldConfig = JSON.stringify(newMitigations);
      }
      window.postMessage(
        {
          source: 'PRINTSHIELD_BRIDGE',
          type: 'UPDATE_CONFIG',
          mitigations: newMitigations
        },
        '*'
      );
    }
  });

  // Listen for detection events from protector-main.js and forward to service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === 'PRINTSHIELD_MAIN' && event.data.type === 'FINGERPRINT_DETECTED') {
      try {
        chrome.runtime.sendMessage({
          type: 'RECORD_FINGERPRINT_EVENT',
          payload: event.data.payload
        });
      } catch (err) {
        // Ignore if service worker is restarting or context invalidated
      }
    }
  });
})();
