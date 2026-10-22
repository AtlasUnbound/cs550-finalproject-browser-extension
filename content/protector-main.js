/**
 * PrintShield — Main-World Fingerprint Detector & Mitigator
 * Runs in the page's MAIN execution world to intercept fingerprinting APIs,
 * report live detection events, and apply user-selected spoofing/generalization.
 */
(function () {
  if (window.__PRINTSHIELD_INSTALLED__) return;
  window.__PRINTSHIELD_INSTALLED__ = true;

  // Read initial mitigation config from dataset attribute set by bridge.js
  let mitigations = {
    canvas: false,
    userAgent: false,
    audio: false,
    webgl: false,
    fonts: false
  };

  try {
    const rawConfig = document.documentElement.dataset.printshieldConfig;
    if (rawConfig) {
      mitigations = { ...mitigations, ...JSON.parse(rawConfig) };
    }
  } catch (e) {
    // Fallback to defaults if parsing fails
  }

  // Listen for dynamic config updates from the extension popup / bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === 'PRINTSHIELD_BRIDGE' && event.data.type === 'UPDATE_CONFIG') {
      mitigations = { ...mitigations, ...event.data.mitigations };
    }
  });

  // Helper to emit fingerprint detection events to the isolated content script
  const reportedCounts = {
    canvas: 0,
    userAgent: 0,
    audio: 0,
    webgl: 0,
    fonts: 0
  };

  function notifyDetection(vector, apiMethod, detail, mitigated) {
    reportedCounts[vector] = (reportedCounts[vector] || 0) + 1;
    // Throttle rapid fire calls (e.g., thousands of font checks) to avoid flooding
    if (reportedCounts[vector] > 25 && reportedCounts[vector] % 25 !== 0) {
      return;
    }
    window.postMessage(
      {
        source: 'PRINTSHIELD_MAIN',
        type: 'FINGERPRINT_DETECTED',
        payload: {
          vector,
          apiMethod,
          detail: String(detail || '').slice(0, 140),
          mitigated: Boolean(mitigated),
          count: reportedCounts[vector],
          timestamp: Date.now()
        }
      },
      '*'
    );
  }

  //Deterministic session noise seed so canvas/audio noise looks consistent per page load
  const sessionSeed = Math.floor(Math.random() * 254) + 1;

  // =========================================================================
  // 1. CANVAS 2D FINGERPRINTING (Priority Vector #1)
  // Intercepts: HTMLCanvasElement.prototype.toDataURL, toBlob,
  //             CanvasRenderingContext2D.prototype.getImageData
  // =========================================================================
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  function applySubtleCanvasNoise(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) return;
      const w = Math.min(canvas.width, 16);
      const h = Math.min(canvas.height, 16);
      const imgData = origGetImageData.call(ctx, 0, 0, w, h);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 16) {
        data[i] = (data[i] ^ (sessionSeed & 0x03)) & 0xff;
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (err) {
      // Tainted cross-origin canvas; ignore silently
    }
  }

  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    const isMitigated = Boolean(mitigations.canvas);
    if (isMitigated) {
      applySubtleCanvasNoise(this);
    }
    notifyDetection(
      'canvas',
      'HTMLCanvasElement.toDataURL()',
      `Canvas (${this.width}x${this.height}) exported to data URI`,
      isMitigated
    );
    return origToDataURL.apply(this, args);
  };

  HTMLCanvasElement.prototype.toBlob = function (...args) {
    const isMitigated = Boolean(mitigations.canvas);
    if (isMitigated) {
      applySubtleCanvasNoise(this);
    }
    notifyDetection(
      'canvas',
      'HTMLCanvasElement.toBlob()',
      `Canvas (${this.width}x${this.height}) exported to binary Blob`,
      isMitigated
    );
    return origToBlob.apply(this, args);
  };

  CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
    const isMitigated = Boolean(mitigations.canvas);
    const imageData = origGetImageData.call(this, sx, sy, sw, sh);
    if (sw >= 16 && sh >= 16) {
      if (isMitigated && imageData && imageData.data) {
        const d = imageData.data;
        for (let i = 0; i < Math.min(d.length, 256); i += 16) {
          d[i] = (d[i] ^ (sessionSeed & 0x02)) & 0xff;
        }
      }
      notifyDetection(
        'canvas',
        'CanvasRenderingContext2D.getImageData()',
        `Pixel buffer read (${sw}x${sh}px)`,
        isMitigated
      );
    }
    return imageData;
  };

  // =========================================================================
  // 2. USER-AGENT & NAVIGATOR PROPERTIES (Priority Vector #3)
  // Intercepts: navigator.userAgent, platform, hardwareConcurrency,
  //             deviceMemory, languages, vendor, userAgentData
  // =========================================================================
  const GENERALIZED_NAVIGATOR = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    appVersion:
      '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    platform: 'Win32',
    hardwareConcurrency: 4,
    deviceMemory: 8,
    language: 'en-US',
    languages: Object.freeze(['en-US', 'en']),
    vendor: 'Google Inc.'
  };

  const navProto = Object.getPrototypeOf(navigator);
  const trackedNavProps = [
    'userAgent',
    'platform',
    'hardwareConcurrency',
    'deviceMemory',
    'language',
    'languages',
    'vendor'
  ];

  trackedNavProps.forEach((prop) => {
    const desc = Object.getOwnPropertyDescriptor(navProto, prop);
    if (!desc || !desc.get) return;

    Object.defineProperty(navProto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () {
        const isMitigated = Boolean(mitigations.userAgent);
        const realVal = desc.get.call(this);
        const returnedVal = isMitigated ? GENERALIZED_NAVIGATOR[prop] : realVal;
        notifyDetection(
          'userAgent',
          `navigator.${prop}`,
          `Read ${prop}: ${ Array.isArray(returnedVal) ? returnedVal.join(', ') : returnedVal }`,
          isMitigated
        );
        return returnedVal;
      }
    });
  });

  // Also intercept navigator.userAgentData.getHighEntropyValues if present
  if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
    const origGetHighEntropy = navigator.userAgentData.getHighEntropyValues;
    navigator.userAgentData.getHighEntropyValues = async function (hints) {
      const isMitigated = Boolean(mitigations.userAgent);
      notifyDetection(
        'userAgent',
        'navigator.userAgentData.getHighEntropyValues()',
        `Requested high-entropy hints: ${(hints || []).join(', ')}`,
        isMitigated
      );
      const realData = await origGetHighEntropy.call(this, hints);
      if (!isMitigated) return realData;
      return {
        ...realData,
        architecture: 'x86',
        bitness: '64',
        model: '',
        platform: 'Windows',
        platformVersion: '10.0.0',
        uaFullVersion: '130.0.0.0'
      };
    };
  }

  // =========================================================================
  // 3. WEB AUDIO / AUDIOCONTEXT FINGERPRINTING
  // Intercepts: AudioBuffer.prototype.getChannelData,
  //             AnalyserNode.prototype.getFloatFrequencyData
  // =========================================================================
  if (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) {
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (channel) {
      const isMitigated = Boolean(mitigations.audio);
      const data = origGetChannelData.call(this, channel);
      if (isMitigated && data && data.length > 0) {
        for (let i = 0; i < Math.min(data.length, 512); i += 32) {
          data[i] = data[i] + (sessionSeed * 1e-7);
        }
      }
      notifyDetection(
        'audio',
        'AudioBuffer.getChannelData()',
        `Audio waveform sample read (${data ? data.length : 0} samples)`,
        isMitigated
      );
      return data;
    };
  }

  if (typeof AnalyserNode !== 'undefined' && AnalyserNode.prototype.getFloatFrequencyData) {
    const origGetFloatFreq = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      const isMitigated = Boolean(mitigations.audio);
      origGetFloatFreq.call(this, array);
      if (isMitigated && array) {
        for (let i = 0; i < array.length; i += 8) {
          array[i] = array[i] + (sessionSeed * 1e-4);
        }
      }
      notifyDetection(
        'audio',
        'AnalyserNode.getFloatFrequencyData()',
        'Audio frequency spectrum analyzed',
        isMitigated
      );
    };
  }

  // =========================================================================
  // 4. WEBGL & GPU HARDWARE FINGERPRINTING
  // Intercepts: WebGLRenderingContext.prototype.getParameter (37445, 37446)
  // =========================================================================
  function patchWebGLContext(ContextProto, contextName) {
    if (!ContextProto || !ContextProto.prototype || !ContextProto.prototype.getParameter) return;
    const origGetParam = ContextProto.prototype.getParameter;
    ContextProto.prototype.getParameter = function (pname) {
      const isMitigated = Boolean(mitigations.webgl);
      const realVal = origGetParam.call(this, pname);
      // UNMASKED_VENDOR_WEBGL = 0x9245 (37445), UNMASKED_RENDERER_WEBGL = 0x9246 (37446)
      if (pname === 37445 || pname === 37446 || pname === 7936 || pname === 7937) {
        let outVal = realVal;
        if (isMitigated) {
          if (pname === 37445 || pname === 7936) outVal = 'Generic WebGL Vendor';
          if (pname === 37446 || pname === 7937) outVal = 'ANGLE (Generic GPU Direct3D11 vs_5_0 ps_5_0)';
        }
        notifyDetection(
          'webgl',
          `${contextName}.getParameter(${pname})`,
          `GPU parameter read: ${outVal}`,
          isMitigated
        );
        return outVal;
      }
      return realVal;
    };
  }

  if (typeof WebGLRenderingContext !== 'undefined') {
    patchWebGLContext(WebGLRenderingContext, 'WebGLRenderingContext');
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchWebGLContext(WebGL2RenderingContext, 'WebGL2RenderingContext');
  }

  // =========================================================================
  // 5. FONT ENUMERATION & TEXT METRICS FINGERPRINTING
  // Intercepts: CanvasRenderingContext2D.prototype.measureText & FontFaceSet.check
  // =========================================================================
  const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText = function (text) {
    const isMitigated = Boolean(mitigations.fonts);
    const metrics = origMeasureText.call(this, text);
    notifyDetection(
      'fonts',
      'CanvasRenderingContext2D.measureText()',
      `Measured glyph width for font "${this.font || 'default'}"`,
      isMitigated
    );
    if (!isMitigated) return metrics;

    // Return a proxy that rounds width slightly to prevent sub-pixel font fingerprinting
    return new Proxy(metrics, {
      get(target, prop) {
        const val = Reflect.get(target, prop);
        if (prop === 'width' && typeof val === 'number') {
          return Math.round(val);
        }
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
  };

  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.check === 'function') {
    const origFontCheck = document.fonts.check;
    document.fonts.check = function (font, text) {
      const isMitigated = Boolean(mitigations.fonts);
      notifyDetection(
        'fonts',
        'document.fonts.check()',
        `Probed installed font: ${font}`,
        isMitigated
      );
      if (isMitigated) {
        const standardFonts = ['arial', 'times new roman', 'courier new', 'georgia', 'verdana', 'sans-serif', 'serif', 'monospace'];
        const lower = String(font).toLowerCase();
        return standardFonts.some((f) => lower.includes(f));
      }
      return origFontCheck.call(this, font, text);
    };
  }
})();
