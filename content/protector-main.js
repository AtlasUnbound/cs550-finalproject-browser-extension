/**
 * PrintShield — Main-World Fingerprint Detector & Mitigator
 *
 * Runs in the page's MAIN JavaScript world at document_start (registered by the
 * service worker via chrome.scripting.registerContentScripts), so every hook is
 * in place before any page script runs.
 *
 * Design goals
 *  1. DETECT every read of a fingerprinting surface and report it (batched) to the
 *     extension so the popup can show, live, which fingerprints the page collected.
 *  2. MITIGATE by making the browser look like the largest possible crowd:
 *       - "Generalize" stable values to the most common real-world value
 *         (e.g. 8 CPU cores, 1920x1080 screen, a common real GPU string).
 *       - "Farble" (add tiny, deterministic per-page noise to) rendering outputs
 *         that cannot be generalized (canvas pixels, audio samples, text metrics),
 *         so the hash is different on every page load and cannot be linked.
 *     Never return values that do not exist in the wild — a fake value like
 *     "Generic GPU" makes a browser MORE unique, not less.
 *  3. STAY HIDDEN: hooked functions keep their native name/length/toString so
 *     fingerprinters cannot easily detect the extension itself.
 *
 * Configuration arrives two ways:
 *  - Synchronously, from tiny content/cfg/<vector>.js files the service worker
 *    registers ahead of this file (one per enabled mitigation).
 *  - Live, from content/bridge.js over a private CustomEvent channel whose event
 *    name contains a random nonce that page scripts never see.
 */
(function printShieldMain() {
  'use strict';

  const W = window;
  const MARK = Symbol.for('printshield.realm');

  // ---------------------------------------------------------------------------
  // 0. Capture natives before any page script can tamper with them
  // ---------------------------------------------------------------------------
  const RApply = Reflect.apply;
  const RConstruct = Reflect.construct;
  const NativeProxy = Proxy;
  const defineProperty = Object.defineProperty;
  const getOwnPropDesc = Object.getOwnPropertyDescriptor;
  const getPrototypeOf = Object.getPrototypeOf;
  const setPrototypeOf = Object.setPrototypeOf;
  const objectCreate = Object.create;
  const objectFreeze = Object.freeze;
  const isArray = Array.isArray;
  const imul = Math.imul;
  const mathMin = Math.min;
  const jsonStringify = JSON.stringify;
  const jsonParse = JSON.parse;
  const PromiseThen = Promise.prototype.then;
  const PromiseResolve = Promise.resolve.bind(Promise);
  const nativeSetTimeout = W.setTimeout.bind(W);
  const nativeToString = Function.prototype.toString;
  const NativeMap = Map;
  const NativeSet = Set;
  const NativeWeakMap = WeakMap;
  const NativeWeakSet = WeakSet;
  const NativeCustomEvent = CustomEvent;
  const dispatchEventNative = EventTarget.prototype.dispatchEvent;
  const addEventListenerNative = EventTarget.prototype.addEventListener;
  const customEventDetail = getOwnPropDesc(CustomEvent.prototype, 'detail').get;
  const getAttributeNative = Element.prototype.getAttribute;
  const setAttributeNative = Element.prototype.setAttribute;
  const removeAttributeNative = Element.prototype.removeAttribute;
  const createElementNative = Document.prototype.createElement;
  const cryptoGetRandomValues = Crypto.prototype.getRandomValues;

  const VECTORS = [
    'canvas', 'userAgent', 'headers', 'webgl', 'screen', 'fonts',
    'audio', 'timezone', 'battery', 'network', 'devices'
  ];

  // ---------------------------------------------------------------------------
  // 1. Private channel to the isolated-world bridge (nonce handshake)
  // ---------------------------------------------------------------------------
  // Whichever script runs first (bridge or this one) writes a random nonce into a
  // DOM attribute; the second reads and removes it. Both run before any page
  // script, so the page never observes the nonce.
  const HANDSHAKE_ATTR = 'data-printshield-handshake';
  function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    RApply(cryptoGetRandomValues, crypto, [arr]);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
    return s;
  }

  let channelNonce = null;
  try {
    const root = document.documentElement;
    if (root) {
      const existing = RApply(getAttributeNative, root, [HANDSHAKE_ATTR]);
      if (existing) {
        channelNonce = existing;
        RApply(removeAttributeNative, root, [HANDSHAKE_ATTR]);
      } else {
        channelNonce = randomHex(16);
        RApply(setAttributeNative, root, [HANDSHAKE_ATTR, channelNonce]);
        // Safety net: if the bridge never shows up, do not leave the nonce in the DOM.
        RApply(addEventListenerNative, document, ['DOMContentLoaded', () => {
          try {
            if (RApply(getAttributeNative, root, [HANDSHAKE_ATTR]) === channelNonce) {
              RApply(removeAttributeNative, root, [HANDSHAKE_ATTR]);
            }
          } catch (e) { /* ignore */ }
        }, { once: true }]);
      }
    }
  } catch (e) {
    channelNonce = null;
  }

  // A frame whose window was already protected by its parent (same-origin
  // about:blank iframes) only needed to consume the handshake above.
  if (W[MARK]) return;
  // A same-origin child frame asks its parent's PrintShield instance to protect it,
  // so parent and child share one noise seed and give identical answers
  // (fingerprinters compare the two to detect spoofing).
  try {
    const parentAdopt = W.parent !== W ? W.parent[MARK] : null;
    if (typeof parentAdopt === 'function') {
      parentAdopt(W);
      if (W[MARK]) return;
    }
  } catch (e) { /* cross-origin parent: protect ourselves below */ }

  const OUT_EVENT = channelNonce ? `printshield-${channelNonce}-out` : null;
  const IN_EVENT = channelNonce ? `printshield-${channelNonce}-in` : null;

  function sendToBridge(message) {
    if (!OUT_EVENT) return;
    try {
      RApply(dispatchEventNative, document, [
        new NativeCustomEvent(OUT_EVENT, { detail: jsonStringify(message) })
      ]);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // 2. Mitigation configuration
  // ---------------------------------------------------------------------------
  const mitigations = {};
  VECTORS.forEach((v) => { mitigations[v] = false; });
  try {
    const flags = W.__printshieldFlags__;
    if (isArray(flags)) flags.forEach((v) => { if (v in mitigations) mitigations[v] = true; });
  } catch (e) { /* ignore */ }
  try { delete W.__printshieldFlags__; } catch (e) { /* ignore */ }

  const realms = []; // WeakRefs to every window we protected (top + same-origin frames)

  function applyConfig(next) {
    if (!next || typeof next !== 'object') return;
    VECTORS.forEach((v) => {
      if (typeof next[v] === 'boolean') mitigations[v] = next[v];
    });
    realms.forEach((ref) => {
      const win = ref.deref ? ref.deref() : ref;
      if (!win) return;
      try { refreshRealmToggles(win); } catch (e) { /* ignore */ }
    });
  }

  if (IN_EVENT) {
    RApply(addEventListenerNative, document, [IN_EVENT, (event) => {
      try {
        const msg = jsonParse(RApply(customEventDetail, event, []));
        if (msg && msg.type === 'config') applyConfig(msg.mitigations);
      } catch (e) { /* ignore */ }
    }]);
  }

  // ---------------------------------------------------------------------------
  // 3. Detection reporting (batched so heavy fingerprinting does not flood IPC)
  // ---------------------------------------------------------------------------
  const pending = new NativeMap();
  let flushScheduled = false;

  function flushReports() {
    flushScheduled = false;
    if (pending.size === 0) return;
    const events = [];
    pending.forEach((e) => events.push(e));
    pending.clear();
    sendToBridge({ type: 'detections', events });
  }

  function report(vector, api, detail, mitigated) {
    const key = `${vector}|${api}`;
    let entry = pending.get(key);
    if (!entry) {
      entry = { vector, api, detail: '', mitigated: false, count: 0, timestamp: 0 };
      pending.set(key, entry);
    }
    entry.count += 1;
    entry.detail = String(detail || '').slice(0, 180);
    entry.mitigated = Boolean(mitigated);
    entry.timestamp = Date.now();
    if (!flushScheduled) {
      flushScheduled = true;
      nativeSetTimeout(flushReports, 400);
    }
  }
  try {
    RApply(addEventListenerNative, W, ['pagehide', flushReports]);
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------
  // 4. Stealth hooking helpers
  // ---------------------------------------------------------------------------
  const fakeSources = new NativeWeakMap(); // fake function -> native source string

  function disguise(fake, original) {
    try {
      fakeSources.set(fake, RApply(nativeToString, original, []));
      defineProperty(fake, 'name', { value: original.name, configurable: true });
      defineProperty(fake, 'length', { value: original.length, configurable: true });
      setPrototypeOf(fake, getPrototypeOf(original)); // correct realm's Function.prototype
    } catch (e) { /* ignore */ }
    return fake;
  }

  function installToStringMask(win) {
    const FP = win.Function.prototype;
    const desc = getOwnPropDesc(FP, 'toString');
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value;
    const masked = ({
      toString() {
        if (fakeSources.has(this)) return fakeSources.get(this);
        return RApply(original, this, arguments);
      }
    }).toString;
    disguise(masked, original);
    defineProperty(FP, 'toString', { ...desc, value: masked });
  }

  /** Replace obj[name] (a method) with handler(original, args). */
  function hookMethod(obj, name, handler) {
    if (!obj) return null;
    const desc = getOwnPropDesc(obj, name);
    if (!desc || typeof desc.value !== 'function') return null;
    const original = desc.value;
    const fake = ({
      [name](...args) {
        return RApply(handler, this, [original, args]);
      }
    })[name];
    disguise(fake, original);
    defineProperty(obj, name, { ...desc, value: fake });
    return original;
  }

  /** Replace an accessor's getter with handler(originalGetter). */
  function hookGetter(obj, name, handler) {
    if (!obj) return null;
    const desc = getOwnPropDesc(obj, name);
    if (!desc || typeof desc.get !== 'function') return null;
    const originalGet = desc.get;
    const fakeGet = getOwnPropDesc({
      get [name]() {
        return RApply(handler, this, [originalGet]);
      }
    }, name).get;
    disguise(fakeGet, originalGet);
    defineProperty(obj, name, { ...desc, get: fakeGet });
    return originalGet;
  }

  function protoOf(win, ctorName) {
    const C = win[ctorName];
    return C && C.prototype ? C.prototype : null;
  }

  // ---------------------------------------------------------------------------
  // 5. Deterministic noise ("farbling")
  // ---------------------------------------------------------------------------
  // One random seed per page load: repeated reads on the same page give the same
  // answer (so scripts cannot spot randomization), but every new page load gets
  // a brand-new, unlinkable canvas/audio fingerprint.
  const SEED = (() => {
    const a = new Uint32Array(1);
    RApply(cryptoGetRandomValues, crypto, [a]);
    return a[0] || 0x9e3779b9;
  })();

  function mix(a, b) {
    let h = (a ^ imul(b | 0, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16; h = imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function hashString(str, seed) {
    let h = seed >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
    return h;
  }

  /** Flip the lowest bit of ~1/16 opaque pixels. Invisible, but changes every hash. */
  function noiseRGBA(data, width, x0, y0, salt) {
    if (!data || !width) return;
    let changed = false;
    let firstOpaque = -1;
    let firstVisible = -1;
    const len = data.length - (data.length % 4);
    for (let p = 0, i = 0; i < len; p++, i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      if (firstVisible < 0) firstVisible = i;
      if (a !== 255) continue; // premultiplied alpha would swallow the change
      if (firstOpaque < 0) firstOpaque = i;
      const x = x0 + (p % width);
      const y = y0 + ((p / width) | 0);
      const h = mix(mix(SEED ^ salt, imul(y, 8191) + x), data[i] | (data[i + 1] << 8) | (data[i + 2] << 16));
      if ((h & 0x0f) !== 0) continue;
      const channel = (h >>> 4) % 3;
      data[i + channel] ^= 1;
      changed = true;
    }
    if (!changed) {
      if (firstOpaque >= 0) data[firstOpaque] ^= 1;
      else if (firstVisible >= 0) data[firstVisible + 3] = data[firstVisible + 3] === 255 ? 254 : data[firstVisible + 3] + 1;
    }
  }

  /** Multiply ~1/4 of non-zero samples by (1 ± ~2.5e-6). Far below audibility. */
  function noiseFloatSamples(arr, salt) {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === 0 || v !== v) continue;
      const h = mix(SEED ^ salt, i);
      if ((h & 3) !== 0) continue;
      arr[i] = v * (1 + (((h >>> 2) & 0xff) - 127.5) * 2e-8);
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Environment facts used to pick realistic, common values
  // ---------------------------------------------------------------------------
  const navProto = Navigator.prototype;
  const realNav = (prop) => {
    const d = getOwnPropDesc(navProto, prop);
    try { return d && d.get ? RApply(d.get, navigator, []) : navigator[prop]; } catch (e) { return undefined; }
  };
  const REAL_UA = String(realNav('userAgent') || '');
  const OS = /Windows/i.test(REAL_UA) ? 'win'
    : /Android/i.test(REAL_UA) ? 'android'
    : /CrOS/.test(REAL_UA) ? 'cros'
    : /Mac OS X|Macintosh/.test(REAL_UA) ? 'mac'
    : /Linux|X11/.test(REAL_UA) ? 'linux' : 'other';
  const IS_DESKTOP = OS !== 'android';
  const CHROME_MAJOR = ((/Chrome\/(\d+)/.exec(REAL_UA) || [])[1]) || '130';

  // Keep the REAL browser, OS and major version (so JavaScript matches the HTTP
  // headers, the brand list and the browser's actual features) and only round
  // detailed version numbers to the "reduced" form Chrome already uses.
  // Pretending to be an older or different browser makes you MORE unique.
  const NORMALIZED_UA = REAL_UA.replace(/\b((?:Chrome|Chromium|HeadlessChrome|Edg|OPR|CriOS)\/\d+)(?:\.\d+){1,3}/g, '$1.0.0.0');
  const NORMALIZED_LANGUAGES = (() => {
    const langs = realNav('languages');
    const first = (langs && langs[0]) || realNav('language') || 'en-US';
    const base = String(first).split('-')[0];
    return objectFreeze(first.indexOf('-') > 0 && base ? [first, base] : [first]);
  })();

  // ---------------------------------------------------------------------------
  // 7. Font profiles (the most common font list per OS). GENERATED — edit
  //    scripts/font-lists.json and run scripts/generate_font_shield.py.
  // ---------------------------------------------------------------------------
  // @@FONT_ALLOWLIST_BEGIN
  const FONT_ALLOWLIST = {
    "win": [
      "Agency FB",
      "Algerian",
      "Arial",
      "Arial Black",
      "Arial Narrow",
      "Bahnschrift",
      "Baskerville Old Face",
      "Bauhaus 93",
      "Bell MT",
      "Berlin Sans FB",
      "Bernard MT Condensed",
      "Blackadder ITC",
      "Bodoni MT",
      "Bodoni MT Black",
      "Bodoni MT Condensed",
      "Book Antiqua",
      "Bookman Old Style",
      "Bookshelf Symbol 7",
      "Bradley Hand ITC",
      "Broadway",
      "Brush Script MT",
      "Calibri",
      "Calibri Light",
      "Californian FB",
      "Calisto MT",
      "Cambria",
      "Cambria Math",
      "Candara",
      "Cascadia Code",
      "Cascadia Mono",
      "Castellar",
      "Centaur",
      "Century",
      "Century Gothic",
      "Century Schoolbook",
      "Chiller",
      "Colonna MT",
      "Comic Sans MS",
      "Consolas",
      "Constantia",
      "Cooper Black",
      "Copperplate Gothic Light",
      "Corbel",
      "Courier",
      "Courier New",
      "Curlz MT",
      "Dubai",
      "Ebrima",
      "Edwardian Script ITC",
      "Elephant",
      "Engravers MT",
      "Felix Titling",
      "Fixedsys",
      "Footlight MT Light",
      "Forte",
      "Franklin Gothic Book",
      "Franklin Gothic Heavy",
      "Franklin Gothic Medium",
      "Freestyle Script",
      "French Script MT",
      "Gabriola",
      "Gadugi",
      "Garamond",
      "Georgia",
      "Gigi",
      "Gill Sans MT",
      "Gill Sans MT Condensed",
      "Goudy Old Style",
      "Goudy Stout",
      "Haettenschweiler",
      "Harrington",
      "Helvetica",
      "High Tower Text",
      "HoloLens MDL2 Assets",
      "Impact",
      "Imprint MT Shadow",
      "Informal Roman",
      "Ink Free",
      "Javanese Text",
      "Jokerman",
      "Juice ITC",
      "Kristen ITC",
      "Kunstler Script",
      "Leelawadee UI",
      "Lucida Bright",
      "Lucida Calligraphy",
      "Lucida Console",
      "Lucida Fax",
      "Lucida Handwriting",
      "Lucida Sans",
      "Lucida Sans Typewriter",
      "Lucida Sans Unicode",
      "Magneto",
      "Maiandra GD",
      "Malgun Gothic",
      "Marlett",
      "Matura MT Script Capitals",
      "Microsoft Himalaya",
      "Microsoft JhengHei",
      "Microsoft New Tai Lue",
      "Microsoft PhagsPa",
      "Microsoft Sans Serif",
      "Microsoft Tai Le",
      "Microsoft YaHei",
      "Microsoft Yi Baiti",
      "MingLiU-ExtB",
      "Mistral",
      "Modern",
      "Modern No. 20",
      "Mongolian Baiti",
      "Monotype Corsiva",
      "MS Gothic",
      "MS Outlook",
      "MS PGothic",
      "MS Reference Sans Serif",
      "MS Reference Specialty",
      "MS Sans Serif",
      "MS Serif",
      "MS UI Gothic",
      "MT Extra",
      "MV Boli",
      "Myanmar Text",
      "Niagara Engraved",
      "Niagara Solid",
      "Nirmala UI",
      "NSimSun",
      "Old English Text MT",
      "Onyx",
      "Palace Script MT",
      "Palatino Linotype",
      "Papyrus",
      "Parchment",
      "Perpetua",
      "Perpetua Titling MT",
      "Playbill",
      "Poor Richard",
      "Pristina",
      "Ravie",
      "Rockwell",
      "Rockwell Condensed",
      "Roman",
      "Script",
      "Segoe Fluent Icons",
      "Segoe MDL2 Assets",
      "Segoe Print",
      "Segoe Script",
      "Segoe UI",
      "Segoe UI Black",
      "Segoe UI Emoji",
      "Segoe UI Historic",
      "Segoe UI Light",
      "Segoe UI Semibold",
      "Segoe UI Semilight",
      "Segoe UI Symbol",
      "Segoe UI Variable",
      "Showcard Gothic",
      "SimSun",
      "Sitka",
      "Small Fonts",
      "Snap ITC",
      "Stencil",
      "Sylfaen",
      "Symbol",
      "System",
      "Tahoma",
      "Tempus Sans ITC",
      "Terminal",
      "Times",
      "Times New Roman",
      "Trebuchet MS",
      "Tw Cen MT",
      "Tw Cen MT Condensed",
      "Verdana",
      "Viner Hand ITC",
      "Vivaldi",
      "Vladimir Script",
      "Webdings",
      "Wide Latin",
      "Wingdings",
      "Wingdings 2",
      "Wingdings 3",
      "Yu Gothic"
    ],
    "mac": [
      "American Typewriter",
      "Andale Mono",
      "Apple Chancery",
      "Apple Color Emoji",
      "Apple SD Gothic Neo",
      "Arial",
      "Arial Black",
      "Arial Narrow",
      "Arial Rounded MT Bold",
      "Arial Unicode MS",
      "Athelas",
      "Avenir",
      "Avenir Next",
      "Avenir Next Condensed",
      "Baskerville",
      "Big Caslon",
      "Bodoni 72",
      "Bradley Hand",
      "Brush Script MT",
      "Chalkboard",
      "Chalkboard SE",
      "Chalkduster",
      "Charter",
      "Cochin",
      "Comic Sans MS",
      "Copperplate",
      "Courier",
      "Courier New",
      "Didot",
      "Futura",
      "Geneva",
      "Georgia",
      "Gill Sans",
      "Helvetica",
      "Helvetica Neue",
      "Herculanum",
      "Hoefler Text",
      "Impact",
      "Iowan Old Style",
      "Lucida Grande",
      "Marker Felt",
      "Menlo",
      "Monaco",
      "Noteworthy",
      "Optima",
      "Palatino",
      "Papyrus",
      "Phosphate",
      "PingFang SC",
      "Rockwell",
      "Savoye LET",
      "Seravek",
      "Skia",
      "Snell Roundhand",
      "Tahoma",
      "Times",
      "Times New Roman",
      "Trattatello",
      "Trebuchet MS",
      "Verdana",
      "Webdings",
      "Wingdings",
      "Wingdings 2",
      "Wingdings 3",
      "Zapfino"
    ],
    "linux": [
      "Cantarell",
      "Courier",
      "DejaVu Sans",
      "DejaVu Sans Mono",
      "DejaVu Serif",
      "FreeMono",
      "FreeSans",
      "FreeSerif",
      "Helvetica",
      "Liberation Mono",
      "Liberation Sans",
      "Liberation Serif",
      "Nimbus Mono PS",
      "Nimbus Roman",
      "Nimbus Sans",
      "Noto Color Emoji",
      "Noto Mono",
      "Noto Sans",
      "Noto Serif",
      "Times",
      "Ubuntu",
      "Ubuntu Mono"
    ]
  };
  // @@FONT_ALLOWLIST_END
  const GENERIC_FAMILIES = new NativeSet([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
    'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial'
  ]);
  const OS_FONTS = new NativeSet((FONT_ALLOWLIST[OS === 'cros' || OS === 'android' || OS === 'other' ? 'linux' : OS] || [])
    .map((f) => f.toLowerCase()));

  function parseFontFamilies(fontShorthand) {
    // "italic bold 16px/2 'Agency FB', serif"  ->  ['agency fb', 'serif']
    const m = /(?:^|\s)[\d.]+(?:px|pt|pc|em|rem|ex|ch|%|vw|vh|q|mm|cm|in)(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(String(fontShorthand));
    const list = m ? m[1] : String(fontShorthand);
    return list.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // 8. Common values used for generalization
  // ---------------------------------------------------------------------------
  const COMMON = {
    hardwareConcurrency: 8, // the most common logical-core count on desktops
    deviceMemory: 8,        // Chrome caps reported RAM at 8 GB, so 8 is the largest crowd
    colorDepth: 24
  };

  const SCREEN_BUCKETS = [
    [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [3840, 2160]
  ];
  const TASKBAR = { win: 40, mac: 25 }[OS] || 0;
  let screenBucket = null;
  const outerWidthGet = (getOwnPropDesc(W, 'outerWidth') || {}).get;
  const outerHeightGet = (getOwnPropDesc(W, 'outerHeight') || {}).get;
  function currentScreenBucket() {
    let ow = 0;
    let oh = 0;
    try {
      ow = outerWidthGet ? RApply(outerWidthGet, W, []) : 0;
      oh = outerHeightGet ? RApply(outerHeightGet, W, []) : 0;
    } catch (e) { /* ignore */ }
    if (screenBucket && screenBucket.w >= ow && screenBucket.h >= oh) return screenBucket;
    let pick = SCREEN_BUCKETS[SCREEN_BUCKETS.length - 1];
    for (const [w, h] of SCREEN_BUCKETS) {
      if (w >= ow && h >= oh) { pick = [w, h]; break; }
    }
    screenBucket = { w: pick[0], h: pick[1], availW: pick[0], availH: pick[1] - TASKBAR };
    return screenBucket;
  }

  const WEBGL_LIMITS = {
    3379: 16384,  // MAX_TEXTURE_SIZE
    34024: 16384, // MAX_RENDERBUFFER_SIZE
    34076: 16384, // MAX_CUBE_MAP_TEXTURE_SIZE
    34921: 16,    // MAX_VERTEX_ATTRIBS
    36347: 4096,  // MAX_VERTEX_UNIFORM_VECTORS
    36349: 1024,  // MAX_FRAGMENT_UNIFORM_VECTORS
    36348: 30,    // MAX_VARYING_VECTORS
    35661: 32,    // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    34930: 16,    // MAX_TEXTURE_IMAGE_UNITS
    35660: 16,    // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    34047: 16     // MAX_TEXTURE_MAX_ANISOTROPY_EXT
  };
  const WEBGL_ARRAY_LIMITS = {
    3386: [32767, 32767], // MAX_VIEWPORT_DIMS
    33902: [1, 1],        // ALIASED_LINE_WIDTH_RANGE
    33901: [1, 1024]      // ALIASED_POINT_SIZE_RANGE
  };
  const WEBGL_COMMON_EXTENSIONS = new NativeSet([
    'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float',
    'EXT_depth_clamp', 'EXT_disjoint_timer_query', 'EXT_disjoint_timer_query_webgl2', 'EXT_float_blend', 'EXT_frag_depth',
    'EXT_polygon_offset_clamp', 'EXT_shader_texture_lod', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
    'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge', 'EXT_sRGB', 'KHR_parallel_shader_compile',
    'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear',
    'OES_texture_half_float', 'OES_texture_half_float_linear', 'OES_vertex_array_object', 'OES_draw_buffers_indexed',
    'OVR_multiview2', 'WEBGL_blend_func_extended', 'WEBGL_clip_cull_distance', 'WEBGL_color_buffer_float',
    'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders',
    'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode',
    'WEBGL_provoking_vertex', 'WEBGL_stencil_texturing'
  ]);

  /**
   * Map the real GPU to a very common REAL GPU string of the same vendor family, in
   * the exact format current Chrome uses (including the PCI device id). Measured on
   * Cover Your Tracks: the UHD 620 string with its device id was shared by 1 in 490
   * browsers; the same string without the id (a format current Chrome no longer
   * produces) by only 1 in 3,387.
   */
  function generalizedGPU(realRenderer) {
    const r = String(realRenderer || '');
    const family = /nvidia|geforce|quadro|rtx|gtx/i.test(r) ? 'nvidia'
      : /\bamd\b|radeon|\bati\b/i.test(r) ? 'amd'
      : /apple|\bm[1-9]\b/i.test(r) ? 'apple'
      : 'intel';
    if (OS === 'mac') {
      if (family === 'apple') return ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'];
      return ['Google Inc. (Intel Inc.)', 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)'];
    }
    if (OS === 'linux' || OS === 'cros' || OS === 'other') {
      if (family === 'nvidia') return ['Google Inc. (NVIDIA Corporation)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.5.0)'];
      if (family === 'amd') return ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Graphics (radeonsi, renoir, LLVM 15.0.7, DRM 3.49, 6.1.0), OpenGL 4.6)'];
      return ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'];
    }
    if (family === 'nvidia') return ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)'];
    if (family === 'amd') return ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)'];
    return ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)'];
  }

  const US_KEYBOARD = (() => {
    const m = new NativeMap();
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c) => m.set(`Key${c.toUpperCase()}`, c));
    '0123456789'.split('').forEach((d) => m.set(`Digit${d}`, d));
    [['Backquote', '`'], ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\'],
      ['Semicolon', ';'], ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['IntlBackslash', '\\']]
      .forEach(([k, v]) => m.set(k, v));
    return m;
  })();

  // ---------------------------------------------------------------------------
  // 9. Per-realm protection (top window + same-origin child frames)
  // ---------------------------------------------------------------------------
  // Natives for the scratch canvas used by the canvas noise (captured before hooking).
  const N = {
    getContext: HTMLCanvasElement.prototype.getContext,
    toDataURL: HTMLCanvasElement.prototype.toDataURL,
    toBlob: HTMLCanvasElement.prototype.toBlob,
    widthSet: getOwnPropDesc(HTMLCanvasElement.prototype, 'width').set,
    heightSet: getOwnPropDesc(HTMLCanvasElement.prototype, 'height').set,
    drawImage: CanvasRenderingContext2D.prototype.drawImage,
    getImageData: CanvasRenderingContext2D.prototype.getImageData,
    putImageData: CanvasRenderingContext2D.prototype.putImageData
  };

  function noisedCanvasCopy(src, width, height) {
    if (!width || !height || width * height > 4000000) return null;
    try {
      const copy = RApply(createElementNative, document, ['canvas']);
      RApply(N.widthSet, copy, [width]);
      RApply(N.heightSet, copy, [height]);
      const ctx = RApply(N.getContext, copy, ['2d']);
      RApply(N.drawImage, ctx, [src, 0, 0]);
      const img = RApply(N.getImageData, ctx, [0, 0, width, height]);
      noiseRGBA(img.data, width, 0, 0, 0x2d);
      RApply(N.putImageData, ctx, [img, 0, 0]);
      return copy;
    } catch (e) {
      return null; // tainted (cross-origin) canvas: export would throw anyway
    }
  }

  const audioNoised = new NativeWeakMap(); // AudioBuffer -> bitmask of noised channels
  const mediaQueryOriginal = new NativeWeakMap();
  const probedFontFamilies = new NativeSet();
  const permissionNamesQueried = new NativeSet();
  const timezoneInstalled = new NativeWeakSet();

  const adoptRealm = disguise(({
    adopt(win) {
      try {
        if (win && !win[MARK] && win.HTMLCanvasElement) protectRealm(win);
      } catch (e) { /* cross-origin */ }
    }
  }).adopt, function () {});

  function protectRealm(win) {
    try {
      defineProperty(win, MARK, { value: adoptRealm, enumerable: false, configurable: false, writable: false });
    } catch (e) {
      return;
    }
    realms.push(typeof WeakRef === 'function' ? new WeakRef(win) : win);

    const sections = [
      installToStringMask, protectCanvas, protectNavigator, protectWebGL, protectScreen, protectFonts,
      protectAudio, protectTimezoneDetection, protectBattery, protectNetwork, protectDevices, protectFrames
    ];
    sections.forEach((fn) => {
      try { fn(win); } catch (e) { /* one failing section must never break the others */ }
    });
    try { refreshRealmToggles(win); } catch (e) { /* ignore */ }
  }

  /** Toggles that need work beyond a per-call flag check. */
  function refreshRealmToggles(win) {
    if (mitigations.timezone) installTimezoneSpoof(win);
  }

  // ---- 9a. Canvas 2D ---------------------------------------------------------
  function protectCanvas(win) {
    const CP = protoOf(win, 'HTMLCanvasElement');
    const C2D = protoOf(win, 'CanvasRenderingContext2D');
    const OCP = protoOf(win, 'OffscreenCanvas');
    const OC2D = protoOf(win, 'OffscreenCanvasRenderingContext2D');

    hookMethod(CP, 'toDataURL', function (original, args) {
      const on = mitigations.canvas;
      report('canvas', 'canvas.toDataURL()', `A ${this.width}×${this.height} canvas drawing was exported as an image`, on);
      if (on) {
        const copy = noisedCanvasCopy(this, this.width, this.height);
        if (copy) return RApply(N.toDataURL, copy, args);
      }
      return RApply(original, this, args);
    });

    hookMethod(CP, 'toBlob', function (original, args) {
      const on = mitigations.canvas;
      report('canvas', 'canvas.toBlob()', `A ${this.width}×${this.height} canvas drawing was exported as a file`, on);
      if (on) {
        const copy = noisedCanvasCopy(this, this.width, this.height);
        if (copy) return RApply(N.toBlob, copy, args);
      }
      return RApply(original, this, args);
    });

    const getImageDataHandler = function (original, args) {
      const img = RApply(original, this, args);
      const on = mitigations.canvas;
      const sw = Math.abs(args[2] | 0);
      const sh = Math.abs(args[3] | 0);
      report('canvas', 'context.getImageData()', `Raw pixels read from a canvas (${sw}×${sh} px)`, on);
      if (on && img && img.data) noiseRGBA(img.data, img.width, args[0] | 0, args[1] | 0, 0x2d);
      return img;
    };
    hookMethod(C2D, 'getImageData', getImageDataHandler);
    hookMethod(OC2D, 'getImageData', getImageDataHandler);

    hookMethod(OCP, 'convertToBlob', function (original, args) {
      const on = mitigations.canvas;
      report('canvas', 'OffscreenCanvas.convertToBlob()', `A hidden ${this.width}×${this.height} off-screen canvas was exported`, on);
      if (on) {
        const copy = noisedCanvasCopy(this, this.width, this.height);
        if (copy) {
          const opts = args[0] || {};
          return new Promise((resolve, reject) => {
            try {
              RApply(N.toBlob, copy, [(blob) => (blob ? resolve(blob) : reject(new DOMException('Export failed', 'EncodingError'))), opts.type, opts.quality]);
            } catch (e) { reject(e); }
          });
        }
      }
      return RApply(original, this, args);
    });
  }

  // ---- 9b. User-Agent & navigator --------------------------------------------
  function protectNavigator(win) {
    const NP = protoOf(win, 'Navigator');
    if (!NP) return;

    const spoofed = {
      userAgent: () => NORMALIZED_UA,
      appVersion: () => NORMALIZED_UA.replace(/^Mozilla\//, ''),
      language: () => NORMALIZED_LANGUAGES[0],
      languages: () => NORMALIZED_LANGUAGES,
      hardwareConcurrency: () => COMMON.hardwareConcurrency,
      deviceMemory: () => COMMON.deviceMemory,
      maxTouchPoints: (real) => (IS_DESKTOP ? 0 : real)
    };
    const detectOnly = ['platform', 'vendor', 'vendorSub', 'productSub', 'product', 'plugins', 'mimeTypes', 'doNotTrack',
      'pdfViewerEnabled', 'cookieEnabled', 'webdriver', 'appName', 'appCodeName', 'oscpu', 'buildID'];

    Object.keys(spoofed).forEach((prop) => {
      hookGetter(NP, prop, function (originalGet) {
        const real = RApply(originalGet, this, []);
        const on = mitigations.userAgent;
        const value = on ? spoofed[prop](real) : real;
        report('userAgent', `navigator.${prop}`,
          `Read ${prop}: ${isArray(value) ? value.join(', ') : value}${on && String(real) !== String(value) ? ' (generalized)' : ''}`, on);
        return value;
      });
    });

    detectOnly.forEach((prop) => {
      hookGetter(NP, prop, function (originalGet) {
        const value = RApply(originalGet, this, []);
        let shown = value;
        if (prop === 'plugins' || prop === 'mimeTypes') shown = `${value ? value.length : 0} entries`;
        report('userAgent', `navigator.${prop}`, `Read ${prop}: ${shown}`, mitigations.userAgent);
        return value;
      });
    });

    // Client Hints JavaScript API (high-entropy values: exact OS build, CPU, model…)
    const UAD = protoOf(win, 'NavigatorUAData');
    hookMethod(UAD, 'getHighEntropyValues', function (original, args) {
      const on = mitigations.userAgent;
      const hints = isArray(args[0]) ? args[0] : [];
      report('userAgent', 'navigator.userAgentData.getHighEntropyValues()',
        `Asked for detailed device hints: ${hints.join(', ') || '(none)'}`, on);
      const result = RApply(original, this, args);
      if (!on) return result;
      return RApply(PromiseThen, result, [(data) => generalizeUAData(data)]);
    });
  }

  function generalizeUAData(data) {
    const out = { ...data };
    const majorOf = (v) => String(v || '0').split('.')[0];
    if ('platformVersion' in out) {
      const major = parseInt(majorOf(out.platformVersion), 10) || 0;
      out.platformVersion = OS === 'win' ? (major >= 13 ? '15.0.0' : '10.0.0') : (OS === 'linux' ? '' : `${major}.0.0`);
    }
    if ('uaFullVersion' in out) out.uaFullVersion = `${CHROME_MAJOR}.0.0.0`;
    if (isArray(out.fullVersionList)) {
      out.fullVersionList = out.fullVersionList.map((b) => ({ brand: b.brand, version: `${majorOf(b.version)}.0.0.0` }));
    }
    if ('model' in out) out.model = '';
    if ('wow64' in out) out.wow64 = false;
    if ('bitness' in out && IS_DESKTOP) out.bitness = '64';
    if ('formFactors' in out && IS_DESKTOP) out.formFactors = ['Desktop'];
    return out;
  }

  // ---- 9c. WebGL / WebGPU -----------------------------------------------------
  function protectWebGL(win) {
    ['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach((ctorName) => {
      const P = protoOf(win, ctorName);
      if (!P) return;

      hookMethod(P, 'getParameter', function (original, args) {
        const pname = args[0];
        const real = RApply(original, this, args);
        const on = mitigations.webgl;

        if (pname === 37445 || pname === 37446) { // UNMASKED_VENDOR / UNMASKED_RENDERER
          let value = real;
          if (on && real != null) { // null = WEBGL_debug_renderer_info not enabled; keep native behaviour
            const rendererReal = pname === 37446 ? real : RApply(original, this, [37446]);
            const [vendor, renderer] = generalizedGPU(rendererReal);
            value = pname === 37445 ? vendor : renderer;
          }
          report('webgl', `${ctorName}.getParameter(${pname === 37445 ? 'UNMASKED_VENDOR' : 'UNMASKED_RENDERER'})`,
            `Graphics card identified as: ${value}${on ? ' (generalized)' : ''}`, on);
          return value;
        }
        if (pname in WEBGL_LIMITS && typeof real === 'number') {
          report('webgl', `${ctorName}.getParameter(hardware limits)`, 'Graphics hardware limits read (texture sizes, shader units…)', on);
          return on ? mathMin(real, WEBGL_LIMITS[pname]) : real;
        }
        if (pname in WEBGL_ARRAY_LIMITS && real && typeof real.length === 'number') {
          report('webgl', `${ctorName}.getParameter(hardware limits)`, 'Graphics hardware limits read (texture sizes, shader units…)', on);
          if (!on) return real;
          const cap = WEBGL_ARRAY_LIMITS[pname];
          const out = new real.constructor(real.length);
          for (let i = 0; i < real.length; i++) out[i] = mathMin(real[i], cap[i] === undefined ? real[i] : cap[i]);
          return out;
        }
        return real;
      });

      hookMethod(P, 'getSupportedExtensions', function (original, args) {
        const list = RApply(original, this, args);
        const on = mitigations.webgl;
        const filtered = on && isArray(list) ? list.filter((e) => WEBGL_COMMON_EXTENSIONS.has(e)) : list;
        report('webgl', `${ctorName}.getSupportedExtensions()`,
          `Listed ${filtered ? filtered.length : 0} graphics extensions${on && list ? ` (${list.length - filtered.length} rare ones hidden)` : ''}`, on);
        return filtered;
      });

      hookMethod(P, 'getExtension', function (original, args) {
        if (mitigations.webgl && !WEBGL_COMMON_EXTENSIONS.has(String(args[0]))) return null;
        return RApply(original, this, args);
      });

      hookMethod(P, 'getShaderPrecisionFormat', function (original, args) {
        report('webgl', `${ctorName}.getShaderPrecisionFormat()`, 'Shader math precision probed', mitigations.webgl);
        return RApply(original, this, args);
      });

      hookMethod(P, 'readPixels', function (original, args) {
        const result = RApply(original, this, args);
        const on = mitigations.webgl;
        const [x, y, w, h, format, type, pixels] = args;
        report('webgl', `${ctorName}.readPixels()`, `A rendered 3D image was read back (${w}×${h} px)`, on);
        if (on && pixels && ArrayBuffer.isView(pixels) && pixels.BYTES_PER_ELEMENT === 1 && format === 0x1908 && type === 0x1401) {
          const view = pixels.length > w * h * 4 ? pixels.subarray(0, w * h * 4) : pixels;
          noiseRGBA(view, w, x | 0, y | 0, 0x91);
        }
        return result;
      });
    });

    // WebGPU adapter info exposes the GPU vendor/architecture directly.
    const GAI = protoOf(win, 'GPUAdapterInfo');
    ['architecture', 'device', 'description'].forEach((prop) => {
      hookGetter(GAI, prop, function (originalGet) {
        const real = RApply(originalGet, this, []);
        const on = mitigations.webgl;
        report('webgl', `GPUAdapterInfo.${prop}`, `WebGPU revealed GPU ${prop}: ${real || '(empty)'}`, on);
        return on ? '' : real;
      });
    });
    const GPUP = protoOf(win, 'GPU');
    hookMethod(GPUP, 'requestAdapter', function (original, args) {
      report('webgl', 'navigator.gpu.requestAdapter()', 'Requested direct access to the GPU (WebGPU)', mitigations.webgl);
      return RApply(original, this, args);
    });
  }

  // ---- 9d. Screen & window geometry -------------------------------------------
  function protectScreen(win) {
    const SP = protoOf(win, 'Screen');
    const values = {
      width: () => currentScreenBucket().w,
      height: () => currentScreenBucket().h,
      availWidth: () => currentScreenBucket().availW,
      availHeight: () => currentScreenBucket().availH,
      availLeft: () => 0,
      availTop: () => 0,
      colorDepth: () => COMMON.colorDepth,
      pixelDepth: () => COMMON.colorDepth,
      isExtended: () => false
    };
    Object.keys(values).forEach((prop) => {
      hookGetter(SP, prop, function (originalGet) {
        const real = RApply(originalGet, this, []);
        const on = mitigations.screen;
        const value = on ? values[prop]() : real;
        report('screen', `screen.${prop}`, `Read screen ${prop}: ${value}${on && value !== real ? ` (real: hidden)` : ''}`, on);
        return value;
      });
    });

    // Window position on the desktop reveals multi-monitor layouts.
    ['screenX', 'screenY', 'screenLeft', 'screenTop'].forEach((prop) => {
      hookGetter(win, prop, function (originalGet) {
        const real = RApply(originalGet, this, []);
        const on = mitigations.screen;
        report('screen', `window.${prop}`, `Read window position ${prop}: ${on ? 0 : real}`, on);
        return on ? 0 : real;
      });
    });

    // CSS media queries can ask for the real device size: matchMedia('(device-width: 1680px)')
    const DEVICE_QUERY = /\(\s*(min-|max-)?device-(width|height)\s*:\s*([\d.]+)px\s*\)/gi;
    hookMethod(win, 'matchMedia', function (original, args) {
      const query = String(args[0]);
      if (!/device-(width|height)/i.test(query)) return RApply(original, this, args);
      const on = mitigations.screen;
      report('screen', 'window.matchMedia(device-size)', `Media query probed real screen size: ${query.slice(0, 80)}`, on);
      if (!on) return RApply(original, this, args);
      const b = currentScreenBucket();
      const rewritten = query.replace(DEVICE_QUERY, (m, prefix, dim, val) => {
        const actual = dim.toLowerCase() === 'width' ? b.w : b.h;
        const v = parseFloat(val);
        const ok = prefix === 'min-' ? actual >= v : prefix === 'max-' ? actual <= v : actual === v;
        return ok ? '(min-width: 0px)' : '(min-width: 99999999px)';
      });
      const mql = RApply(original, this, [rewritten]);
      try { mediaQueryOriginal.set(mql, query); } catch (e) { /* ignore */ }
      return mql;
    });
    hookGetter(protoOf(win, 'MediaQueryList'), 'media', function (originalGet) {
      return mediaQueryOriginal.has(this) ? mediaQueryOriginal.get(this) : RApply(originalGet, this, []);
    });
  }

  // ---- 9e. Fonts ----------------------------------------------------------------
  const shieldFaces = new NativeWeakSet();
  const fontFaceGetter = (prop) => (getOwnPropDesc(FontFace.prototype, prop) || {}).get;
  const unicodeRangeGet = fontFaceGetter('unicodeRange');
  const familyGet = fontFaceGetter('family');
  const statusGet = fontFaceGetter('status');

  /**
   * Faces injected by content/fonts/font-shield-*.css: "hide" faces cover only
   * U+10FFFF, "emulate" faces cover U+0-10FFFE. Pages never use these exact ranges.
   */
  function isShieldFace(face) {
    if (shieldFaces.has(face)) return true;
    try {
      const range = String(RApply(unicodeRangeGet, face, [])).toUpperCase();
      if (range === 'U+10FFFF' || range === 'U+0-10FFFE') {
        shieldFaces.add(face);
        return true;
      }
    } catch (e) { /* not a FontFace */ }
    return false;
  }

  function isWebFontLoaded(faces, family) {
    for (const face of faces) {
      try {
        if (RApply(statusGet, face, []) === 'loaded'
          && String(RApply(familyGet, face, [])).replace(/^["']|["']$/g, '').toLowerCase() === family) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function protectFonts(win) {
    const FFS = protoOf(win, 'FontFaceSet');
    const origValues = FFS && FFS.values;
    // The page's view of document.fonts, minus PrintShield's own hidden faces
    // (otherwise the ~300 shield faces would reveal the extension).
    const visibleFaces = (set) => {
      const out = [];
      if (!origValues) return out;
      const it = RApply(origValues, set, []);
      for (let step = it.next(); !step.done; step = it.next()) {
        if (!isShieldFace(step.value)) out.push(step.value);
      }
      return out;
    };
    const arrayValues = Array.prototype.values;

    hookMethod(FFS, 'check', function (original, args) {
      const on = mitigations.fonts;
      const families = parseFontFamilies(args[0]);
      report('fonts', 'document.fonts.check()', `Asked whether the font "${families[0] || args[0]}" is installed`, on);
      if (on) {
        // Answer like the common font profile: profile fonts are "installed",
        // everything else is not (unless the page loaded it as a web font).
        const faces = visibleFaces(this);
        let pageWebFont = false;
        for (const fam of families) {
          if (GENERIC_FAMILIES.has(fam) || OS_FONTS.has(fam)) continue;
          if (!isWebFontLoaded(faces, fam)) return false;
          pageWebFont = true;
        }
        if (!pageWebFont) return true;
      }
      return RApply(original, this, args);
    });

    ['values', 'keys'].forEach((name) => {
      hookMethod(FFS, name, function () {
        return RApply(arrayValues, visibleFaces(this), []);
      });
    });
    hookMethod(FFS, 'entries', function () {
      return RApply(arrayValues, visibleFaces(this).map((f) => [f, f]), []);
    });
    hookMethod(FFS, 'forEach', function (original, args) {
      const [callback, thisArg] = args;
      if (typeof callback !== 'function') return RApply(original, this, args);
      visibleFaces(this).forEach((face) => RApply(callback, thisArg, [face, face, this]));
      return undefined;
    });
    hookGetter(FFS, 'size', function () {
      return visibleFaces(this).length;
    });
    const fontIterDesc = FFS && getOwnPropDesc(FFS, Symbol.iterator);
    if (fontIterDesc && typeof fontIterDesc.value === 'function') {
      const fakeIter = ({
        values() {
          return RApply(arrayValues, visibleFaces(this), []);
        }
      }).values;
      disguise(fakeIter, fontIterDesc.value);
      defineProperty(FFS, Symbol.iterator, { ...fontIterDesc, value: fakeIter });
    }

    // Canvas text measurement: font detection compares text width in a candidate
    // font vs. a fallback font. Hidden fonts already fall back (the font-shield
    // CSS applies to canvas text too), so widths match a default install. Adding
    // noise here would backfire: every probed font would look "installed".
    const measureHandler = function (original, args) {
      const font = String(this.font || '');
      report('fonts', 'canvas measureText()', `Measured text width in font ${font.slice(0, 60)}`, mitigations.fonts);
      return RApply(original, this, args);
    };
    hookMethod(protoOf(win, 'CanvasRenderingContext2D'), 'measureText', measureHandler);
    hookMethod(protoOf(win, 'OffscreenCanvasRenderingContext2D'), 'measureText', measureHandler);

    // DOM font probing: scripts put text in an element styled "SomeFont, monospace"
    // and read its width/height for hundreds of fonts.
    const noteProbe = (el) => {
      try {
        const style = el.style;
        const ff = style && style.fontFamily;
        if (!ff || ff.indexOf(',') < 0) return;
        const first = parseFontFamilies(`1px ${ff}`)[0];
        if (!first || GENERIC_FAMILIES.has(first) || probedFontFamilies.has(first)) return;
        probedFontFamilies.add(first);
        const n = probedFontFamilies.size;
        if (n >= 6) {
          report('fonts', 'element size measurement', `Measured text in ${n} different fonts to test which are installed (latest: "${first}")`, mitigations.fonts);
        }
      } catch (e) { /* ignore */ }
    };
    const HEP = protoOf(win, 'HTMLElement');
    ['offsetWidth', 'offsetHeight'].forEach((prop) => {
      hookGetter(HEP, prop, function (originalGet) {
        noteProbe(this);
        return RApply(originalGet, this, []);
      });
    });
    hookMethod(protoOf(win, 'Element'), 'getBoundingClientRect', function (original, args) {
      noteProbe(this);
      return RApply(original, this, args);
    });

    // Local Font Access API returns the full list of installed fonts.
    hookMethod(win, 'queryLocalFonts', function (original, args) {
      const on = mitigations.fonts;
      report('fonts', 'window.queryLocalFonts()', 'Requested the complete list of installed fonts', on);
      if (on) return PromiseResolve([]);
      return RApply(original, this, args);
    });
  }

  // ---- 9f. Web Audio --------------------------------------------------------------
  function protectAudio(win) {
    const ABP = protoOf(win, 'AudioBuffer');
    const origGetChannelData = ABP && ABP.getChannelData;

    function ensureNoised(buffer, channel) {
      if (!mitigations.audio || !origGetChannelData) return;
      const bit = 1 << (channel & 31);
      const mask = audioNoised.get(buffer) || 0;
      if (mask & bit) return;
      let samples;
      try { samples = RApply(origGetChannelData, buffer, [channel]); } catch (e) { return; }
      let hasSound = false;
      for (let i = 0; i < samples.length; i++) { if (samples[i] !== 0) { hasSound = true; break; } }
      if (!hasSound) return; // still empty: the page may fill it later, noise then
      audioNoised.set(buffer, mask | bit);
      noiseFloatSamples(samples, 0xa0 + channel);
    }

    hookMethod(ABP, 'getChannelData', function (original, args) {
      const on = mitigations.audio;
      const data = RApply(original, this, args);
      report('audio', 'AudioBuffer.getChannelData()', `Read ${data ? data.length : 0} raw audio samples`, on);
      ensureNoised(this, args[0] | 0);
      return data;
    });

    hookMethod(ABP, 'copyFromChannel', function (original, args) {
      const on = mitigations.audio;
      report('audio', 'AudioBuffer.copyFromChannel()', 'Copied raw audio samples out of a buffer', on);
      ensureNoised(this, args[1] | 0);
      return RApply(original, this, args);
    });

    hookMethod(protoOf(win, 'OfflineAudioContext'), 'startRendering', function (original, args) {
      report('audio', 'OfflineAudioContext.startRendering()',
        'Silently rendered a sound in the background (the classic audio fingerprint)', mitigations.audio);
      return RApply(original, this, args);
    });

    const ANP = protoOf(win, 'AnalyserNode');
    hookMethod(ANP, 'getFloatFrequencyData', function (original, args) {
      const result = RApply(original, this, args);
      const on = mitigations.audio;
      report('audio', 'AnalyserNode.getFloatFrequencyData()', 'Analyzed the frequency spectrum of generated audio', on);
      const arr = args[0];
      if (on && arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] === -Infinity) continue;
          arr[i] += ((mix(SEED ^ 0xf1, i) & 0xff) - 127.5) * 1e-6;
        }
      }
      return result;
    });
    hookMethod(ANP, 'getFloatTimeDomainData', function (original, args) {
      const result = RApply(original, this, args);
      const on = mitigations.audio;
      report('audio', 'AnalyserNode.getFloatTimeDomainData()', 'Read the raw waveform of generated audio', on);
      if (on) noiseFloatSamples(args[0], 0xf2);
      return result;
    });
  }

  // ---- 9g. Time zone ----------------------------------------------------------------
  // Many IANA zones run exactly the same clock (America/Detroit = America/New_York).
  // Reporting the most-used name of the group hides which one you picked, while your
  // offset and every displayed time stay correct. (Spoofing UTC was tried: common on
  // amiunique.org, but only 1 in 91 browsers on Cover Your Tracks, and every clock
  // on the web showed the wrong time.)
  const TZ_CROWDS = {
    'America/New_York': ['America/Detroit', 'America/Toronto', 'America/Montreal', 'America/Nassau', 'America/Indiana/Indianapolis',
      'America/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo',
      'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Kentucky/Louisville', 'America/Louisville',
      'America/Kentucky/Monticello', 'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit', 'US/Eastern', 'EST5EDT'],
    'America/Chicago': ['America/Winnipeg', 'America/Menominee', 'America/Indiana/Knox', 'America/Indiana/Tell_City',
      'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah', 'America/Rainy_River',
      'America/Rankin_Inlet', 'America/Resolute', 'America/Matamoros', 'US/Central', 'CST6CDT'],
    'America/Denver': ['America/Boise', 'America/Edmonton', 'America/Yellowknife', 'America/Cambridge_Bay', 'America/Inuvik',
      'America/Ciudad_Juarez', 'US/Mountain', 'MST7MDT'],
    'America/Los_Angeles': ['America/Vancouver', 'America/Tijuana', 'US/Pacific', 'PST8PDT'],
    'America/Phoenix': ['America/Creston', 'US/Arizona'],
    'Europe/London': ['Europe/Dublin', 'Europe/Lisbon', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Faroe', 'Europe/Guernsey',
      'Europe/Jersey', 'Europe/Isle_of_Man', 'Europe/Belfast', 'GB'],
    'Europe/Berlin': ['Europe/Amsterdam', 'Europe/Andorra', 'Europe/Belgrade', 'Europe/Bratislava', 'Europe/Brussels',
      'Europe/Budapest', 'Europe/Busingen', 'Europe/Copenhagen', 'Europe/Gibraltar', 'Europe/Ljubljana', 'Europe/Luxembourg',
      'Europe/Madrid', 'Europe/Malta', 'Europe/Monaco', 'Europe/Oslo', 'Europe/Paris', 'Europe/Podgorica', 'Europe/Prague',
      'Europe/Rome', 'Europe/San_Marino', 'Europe/Sarajevo', 'Europe/Skopje', 'Europe/Stockholm', 'Europe/Tirane',
      'Europe/Vaduz', 'Europe/Vatican', 'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zagreb', 'Europe/Zurich',
      'Arctic/Longyearbyen', 'Africa/Ceuta', 'CET'],
    'Europe/Bucharest': ['Europe/Athens', 'Europe/Helsinki', 'Europe/Kiev', 'Europe/Kyiv', 'Europe/Mariehamn', 'Europe/Riga',
      'Europe/Sofia', 'Europe/Tallinn', 'Europe/Vilnius', 'EET'],
    'Australia/Sydney': ['Australia/Melbourne', 'Australia/Canberra', 'Australia/Hobart', 'Australia/ACT', 'Australia/NSW',
      'Australia/Victoria', 'Australia/Tasmania'],
    'Asia/Kolkata': ['Asia/Calcutta'],
    'Asia/Shanghai': ['Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'PRC'],
    'Asia/Tokyo': ['Japan']
  };
  const REAL_TIMEZONE = (() => {
    try { return new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; }
  })();
  const CROWD_TIMEZONE = (() => {
    for (const crowd of Object.keys(TZ_CROWDS)) {
      if (TZ_CROWDS[crowd].indexOf(REAL_TIMEZONE) >= 0) return crowd;
    }
    return REAL_TIMEZONE;
  })();
  const tzNeedsChange = () => mitigations.timezone && CROWD_TIMEZONE && CROWD_TIMEZONE !== REAL_TIMEZONE;

  function protectTimezoneDetection(win) {
    const DP = win.Date.prototype;
    hookMethod(DP, 'getTimezoneOffset', function (original, args) {
      const value = RApply(original, this, args);
      report('timezone', 'Date.getTimezoneOffset()', `Read time-zone offset: UTC${formatOffset(value)}`, mitigations.timezone);
      return value;
    });

    const DTFP = win.Intl && win.Intl.DateTimeFormat && win.Intl.DateTimeFormat.prototype;
    hookMethod(DTFP, 'resolvedOptions', function (original, args) {
      const opts = RApply(original, this, args);
      report('timezone', 'Intl.DateTimeFormat().resolvedOptions()',
        `Read time-zone name: ${opts && opts.timeZone}${tzNeedsChange() && opts && opts.timeZone === CROWD_TIMEZONE ? ' (generalized)' : ''}`,
        mitigations.timezone);
      return opts;
    });

    const Now = win.Temporal && win.Temporal.Now;
    hookMethod(Now, 'timeZoneId', function (original, args) {
      const value = tzNeedsChange() ? CROWD_TIMEZONE : RApply(original, this, args);
      report('timezone', 'Temporal.Now.timeZoneId()', `Read time-zone name: ${value}`, mitigations.timezone);
      return value;
    });
  }

  function formatOffset(minutesWest) {
    const total = -minutesWest;
    const sign = total >= 0 ? '+' : '-';
    const abs = Math.abs(total);
    const hh = String((abs / 60) | 0).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  }

  /** Intl.DateTimeFormat without an explicit timeZone -> the crowd zone (same clock). */
  function installTimezoneSpoof(win) {
    if (timezoneInstalled.has(win) || CROWD_TIMEZONE === REAL_TIMEZONE) return;
    timezoneInstalled.add(win);
    const Intl = win.Intl;
    if (!Intl || !Intl.DateTimeFormat) return;
    const withCrowd = (options) => {
      if (!tzNeedsChange()) return options;
      if (options === undefined || options === null) return { timeZone: CROWD_TIMEZONE };
      if (typeof options !== 'object' || options.timeZone !== undefined) return options;
      return { ...options, timeZone: CROWD_TIMEZONE };
    };
    const OrigDTF = Intl.DateTimeFormat;
    const DTFProxy = new NativeProxy(OrigDTF, {
      construct(target, args, newTarget) {
        return RConstruct(target, [args[0], withCrowd(args[1])], newTarget);
      },
      apply(target, thisArg, args) {
        return RApply(target, thisArg, [args[0], withCrowd(args[1])]);
      }
    });
    fakeSources.set(DTFProxy, RApply(nativeToString, OrigDTF, []));
    defineProperty(Intl, 'DateTimeFormat', { ...getOwnPropDesc(Intl, 'DateTimeFormat'), value: DTFProxy });
    defineProperty(OrigDTF.prototype, 'constructor', { ...getOwnPropDesc(OrigDTF.prototype, 'constructor'), value: DTFProxy });
  }

  // ---- 9h. Battery --------------------------------------------------------------
  function protectBattery(win) {
    hookMethod(protoOf(win, 'Navigator'), 'getBattery', function (original, args) {
      const on = mitigations.battery;
      report('battery', 'navigator.getBattery()',
        on ? 'Battery read — reported as a plugged-in, fully charged device' : 'Read your exact battery level and charging state', on);
      return RApply(original, this, args);
    });
    const BP = protoOf(win, 'BatteryManager');
    const fixed = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 };
    Object.keys(fixed).forEach((prop) => {
      hookGetter(BP, prop, function (originalGet) {
        return mitigations.battery ? fixed[prop] : RApply(originalGet, this, []);
      });
    });
  }

  // ---- 9i. Network information -------------------------------------------------
  function protectNetwork(win) {
    hookGetter(protoOf(win, 'Navigator'), 'connection', function (originalGet) {
      report('network', 'navigator.connection', 'Read your network speed and latency estimates', mitigations.network);
      return RApply(originalGet, this, []);
    });
    const NIP = protoOf(win, 'NetworkInformation');
    const fixed = { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false };
    Object.keys(fixed).forEach((prop) => {
      hookGetter(NIP, prop, function (originalGet) {
        const real = RApply(originalGet, this, []);
        const on = mitigations.network;
        const value = on ? fixed[prop] : real;
        report('network', `navigator.connection.${prop}`, `Read connection ${prop}: ${value}`, on);
        return value;
      });
    });
  }

  // ---- 9j. Keyboard layout, media devices, permission probing --------------------
  function protectDevices(win) {
    hookMethod(protoOf(win, 'Keyboard'), 'getLayoutMap', function (original, args) {
      const on = mitigations.devices;
      report('devices', 'navigator.keyboard.getLayoutMap()',
        on ? 'Keyboard layout read — reported as standard US QWERTY' : 'Read your keyboard layout (reveals language/region)', on);
      return RApply(original, this, args);
    });

    // Keep the REAL map's keys and order (the way a real US-layout browser returns
    // them) and only swap values that differ from US QWERTY. Returning our own Map
    // changed the order/type and made the value unique instead of common.
    const KLM = protoOf(win, 'KeyboardLayoutMap');
    if (KLM) {
      const origEntries = KLM.entries;
      const emulated = new NativeWeakMap(); // real map -> array of [code, char] or null (already US)
      const usEntries = (map) => {
        if (emulated.has(map)) return emulated.get(map);
        const out = [];
        let differs = false;
        const it = RApply(origEntries, map, []);
        for (let step = it.next(); !step.done; step = it.next()) {
          const [code, real] = step.value;
          const us = US_KEYBOARD.has(code) ? US_KEYBOARD.get(code) : real;
          if (us !== real) differs = true;
          out.push([code, us]);
        }
        const result = differs ? out : null;
        emulated.set(map, result);
        return result;
      };
      const arrayValues = Array.prototype.values;
      const emulate = {
        get: (list, args) => { const hit = list.find((e) => e[0] === args[0]); return hit ? hit[1] : undefined; },
        has: (list, args) => list.some((e) => e[0] === args[0]),
        keys: (list) => RApply(arrayValues, list.map((e) => e[0]), []),
        values: (list) => RApply(arrayValues, list.map((e) => e[1]), []),
        entries: (list) => RApply(arrayValues, list.map((e) => [e[0], e[1]]), [])
      };
      Object.keys(emulate).forEach((name) => {
        hookMethod(KLM, name, function (original, args) {
          const list = mitigations.devices ? usEntries(this) : null;
          return list ? emulate[name](list, args) : RApply(original, this, args);
        });
      });
      hookMethod(KLM, 'forEach', function (original, args) {
        const list = mitigations.devices ? usEntries(this) : null;
        if (!list || typeof args[0] !== 'function') return RApply(original, this, args);
        list.forEach((e) => RApply(args[0], args[1], [e[1], e[0], this]));
        return undefined;
      });
      hookGetter(KLM, 'size', function (originalGet) {
        const list = mitigations.devices ? usEntries(this) : null;
        return list ? list.length : RApply(originalGet, this, []);
      });
      const iterDesc = getOwnPropDesc(KLM, Symbol.iterator);
      if (iterDesc && typeof iterDesc.value === 'function') {
        const origIter = iterDesc.value;
        const fakeIter = ({
          entries() {
            const list = mitigations.devices ? usEntries(this) : null;
            return list ? emulate.entries(list) : RApply(origIter, this, []);
          }
        }).entries;
        disguise(fakeIter, origIter);
        defineProperty(KLM, Symbol.iterator, { ...iterDesc, value: fakeIter });
      }
    }

    const MDP = protoOf(win, 'MediaDevices');
    const MDI = protoOf(win, 'MediaDeviceInfo');
    hookMethod(MDP, 'enumerateDevices', function (original, args) {
      const result = RApply(original, this, args);
      return RApply(PromiseThen, result, [(list) => {
        const on = mitigations.devices;
        const counts = {};
        (list || []).forEach((d) => { counts[d.kind] = (counts[d.kind] || 0) + 1; });
        report('devices', 'mediaDevices.enumerateDevices()',
          `Listed cameras/microphones/speakers: ${Object.keys(counts).map((k) => `${counts[k]} ${k}`).join(', ') || 'none'}`, on);
        if (!on || !isArray(list) || list.some((d) => d.label)) return list; // permission granted: keep real devices so calls work
        return ['audioinput', 'videoinput', 'audiooutput'].map((kind) => {
          const real = list.find((d) => d.kind === kind);
          if (real) return real;
          const groupId = randomHexFromSeed(kind);
          const fake = objectCreate(MDI || Object.prototype);
          const fields = { deviceId: '', kind, label: '', groupId };
          Object.keys(fields).forEach((k) => defineProperty(fake, k, { value: fields[k], enumerable: true }));
          defineProperty(fake, 'toJSON', { value: () => ({ ...fields }) });
          return fake;
        });
      }]);
    });

    hookMethod(protoOf(win, 'Permissions'), 'query', function (original, args) {
      let name = '';
      try { name = String(args[0] && args[0].name); } catch (e) { /* ignore */ }
      permissionNamesQueried.add(name);
      if (permissionNamesQueried.size >= 3) {
        report('devices', 'navigator.permissions.query()',
          `Checked ${permissionNamesQueried.size} permission states (latest: ${name})`, false);
      }
      return RApply(original, this, args);
    });
  }

  function randomHexFromSeed(salt) {
    let s = '';
    let h = hashString(salt, SEED);
    while (s.length < 64) {
      h = mix(h, s.length);
      s += (h >>> 0).toString(16).padStart(8, '0');
    }
    return s.slice(0, 64);
  }

  // ---- 9k. Same-origin frames: protect them synchronously on first access -------
  function protectFrames(win) {
    const tryProtect = (child) => {
      try {
        if (!child || child === win || child[MARK]) return;
        if (!child.HTMLCanvasElement) return; // throws for cross-origin frames
        protectRealm(child);
      } catch (e) { /* cross-origin: its own content script protects it */ }
    };
    ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'].forEach((ctorName) => {
      const P = protoOf(win, ctorName);
      hookGetter(P, 'contentWindow', function (originalGet) {
        const w = RApply(originalGet, this, []);
        tryProtect(w);
        return w;
      });
      hookGetter(P, 'contentDocument', function (originalGet) {
        const d = RApply(originalGet, this, []);
        if (d) tryProtect(d.defaultView);
        return d;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Go
  // ---------------------------------------------------------------------------
  protectRealm(W);
  // Ask the bridge for the current settings (covers pages such as the Test Lab,
  // where this script loads after the bridge has already pushed its config).
  sendToBridge({ type: 'ready' });
})();
