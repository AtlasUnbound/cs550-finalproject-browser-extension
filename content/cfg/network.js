// Config flag (registered by the service worker only while the 'network' mitigation is ON).
// Runs right before protector-main.js so the setting is known before any page script runs.
(globalThis.__printshieldFlags__ = globalThis.__printshieldFlags__ || []).push('network');
