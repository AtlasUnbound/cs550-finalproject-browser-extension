# PrintShield: Digital Fingerprint Visualizer & Mitigator

**Course:** CS-550 (Professor Albayram)  
**Research Team:** Aidan Gillen, Alexander Torino, Brendan Tierney

---

## 📖 Project Overview

As users become more aware of online tracking methods like cookies and digital fingerprinting, the mechanics behind browser fingerprinting remain opaque to most people. Existing anti-fingerprinting tools often cater to technical users, break site usability, or omit the educational elements needed for users to build accurate mental models of their online privacy.

**PrintShield** is a human-centric Manifest V3 Chromium browser extension built for our CS-550 research study that:
1. **Detects & Visualizes Digital Footprint Vectors** in real time as websites call fingerprinting APIs.
2. **Educates Users** with a first-run introduction and plain-language *"Learn more"* drawers detailing what trackers learn, how mitigations work, and potential site compatibility trade-offs.
3. **Mitigates Fingerprinting** with per-vector or one-click toggles across **11 vectors** (Canvas, Browser Identity & Hardware, HTTP Headers, WebGL/GPU, Screen, Installed Fonts, Web Audio, Time Zone, Battery, Network, Keyboard & Media Devices). The guiding principle is **blend in, don't stand out**: stable values are replaced with the *most common real-world value* (8 cores, 1920×1080, a common real GPU string, the most common font list for your OS), and rendering outputs that cannot be generalized (canvas, audio) get invisible per-visit noise so they cannot be linked between visits. Made-up values such as "Generic GPU" are never used, because no real device reports them and they make a browser *more* unique.
4. **Quantifies Privacy Protection** through a dynamic visual **Footprint Protection Score (0%–100%)** and toolbar badge.
5. **Includes a Built-in Interactive Test Lab** (`sandbox/test-lab.html`) so user study participants can safely trigger and compare raw vs. mitigated fingerprints.

---

## 🚀 Installation (Chrome / Edge / Brave Developer Mode)

This section also serves as **Task 1 (Setup and Inspection)** in our participant study walkthrough:

1. Clone or download this repository to your computer:
   ```bash
   git clone https://github.com/AtlasUnbound/cs550-finalproject-browser-extension.git
   ```
2. Open Google Chrome (or any Chromium browser) and navigate to:
   ```
   chrome://extensions
   ```
3. Toggle **Developer mode** ON in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the root folder of this repository (`finalbroswerproject`).
6. Pin **PrintShield** from the extensions puzzle icon in your browser toolbar.

---

## 🧪 User Study Walkthrough (Tasks 1–3)

### Task 1: Setup & Inspection
1. Click the **PrintShield** icon in your toolbar to open the dashboard popup.
2. Click the **Test Lab** button in the top-right of the popup to launch the interactive study sandbox (`sandbox/test-lab.html`).
3. The Test Lab runs every test when it opens (click **Run all tests again** to repeat them). Re-open the PrintShield popup to see which details the page checked.
4. On first use, the popup shows a short **"What is browser fingerprinting?"** introduction. The **?** button in the header reopens it.

### Task 2: Understanding Fingerprints
1. Inside the PrintShield popup, inspect the list **"What websites can learn about you"**. Each item has a plain-language name, with the technical name under **Technical details**:

   | Popup name (technical vector) | Weight | What it covers (amiunique.org attributes) |
   |---|---|---|
   | **Hidden drawing test** (Canvas) *(High risk)* | 15% | Canvas hash, OffscreenCanvas |
   | **Browser & device details** (User agent) *(High risk)* | 12% | User agent, platform, CPU cores, device memory, languages, Client Hints, plugins, Do Not Track (navigator property list: detection and education only) |
   | **Info sent with every request** (HTTP headers) *(Automatic)* | 8% | Accept, Accept-Language, User-Agent header, high-entropy Client Hints; turns off Chrome page preloading while on |
   | **Graphics card** (WebGL) | 13% | WebGL vendor/renderer, parameters, extensions, WebGL image data, WebGPU adapter info |
   | **Screen size** | 10% | Screen width/height, available area, color depth, window position, device-size media queries |
   | **Installed Fonts** | 12% | DOM and canvas font probing, `document.fonts.check()`, Local Font Access |
   | **Hidden sound test** (Web Audio) | 8% | Audio data, frequency analyser |
   | **Time Zone** | 6% | Time-zone name (offset is left real so clocks stay correct) |
   | **Battery level** | 6% | Battery level and charging state |
   | **Internet connection** | 5% | Connection type, downlink, RTT, Data Saver |
   | **Keyboard, camera & mic** | 5% | Keyboard layout, media device counts, permission probing (detection only) |

2. Click **"Learn more ▼"** on any item to read what sites can learn, why it can identify you, what PrintShield does, its side effects and **what it can't hide**. Test-site statistics and the browser features the page used are under **Technical details**.
3. Open **"For testers: reading amiunique.org and Cover Your Tracks results"** in the popup to learn why randomized values show as "unique" and why brand-new browser versions look rare on amiunique.org.
4. The **What this page checked, live** feed and the toolbar badge show each fingerprint read as it happens, including reads from embedded third-party frames.

### Task 3: Mitigation Testing
1. Turn on individual switches, or click **Turn on protection** to turn them all on. **Turn all off** can be undone for 10 seconds.
2. Observe the change in the **Protection level** ring and status badge, then click **Reload page** in the yellow notice so the changes take effect.
3. Reload the **Test Lab** tab. The **Fingerprint ID** now changes on every reload ("cannot be linked"), hardware values become common ones (`8 logical cores / 8 GB RAM`, a common screen size, a common GPU), and only your OS's default fonts are detected.
4. Browse 2–3 standard websites (news sites, media sites, etc.) to evaluate browsing usability and check for any site degradation.

---

## 🗂️ Repository Architecture

```text
finalbroswerproject/
├── manifest.json                 # Manifest V3 extension configuration
├── background/
│   └── service-worker.js         # MV3 service worker (script registration, header rules, badge, score, detections)
├── content/
│   ├── bridge.js                 # Isolated-world content script (private nonce channel, settings sync, detection relay)
│   ├── protector-main.js         # Main-world detector & mitigator for all 11 vectors (registered by the service worker)
│   ├── cfg/<vector>.js           # Tiny flag files registered before protector-main.js so settings apply before page scripts run
│   └── fonts/font-shield-*.css   # GENERATED per-OS stylesheets that hide non-default fonts
├── popup/
│   ├── popup.html                # Extension popup dashboard UI
│   ├── popup.css                 # Responsive dark-mode styling & SVG score ring
│   └── popup.js                  # Dashboard logic, educational tooltips, toggle handlers
├── sandbox/
│   ├── test-lab.html             # Interactive fingerprinting test page for study participants
│   ├── test-lab.css              # Test Lab stylesheet
│   └── test-lab.js               # Live probes for every vector + a Combined Fingerprint ID
├── icons/                        # Extension icons (16x16, 48x48, 128x128 PNGs)
├── scripts/
│   ├── generate_icons.ps1        # Icon generation utility script
│   ├── font-lists.json           # Source of truth: per-OS default fonts + fonts to hide
│   └── generate_font_shield.py   # Regenerates content/fonts/*.css and the allow list in protector-main.js
└── .github/
    ├── workflows/ci.yml          # Automated Manifest V3 & JS syntax validation on push/PR
    └── pull_request_template.md  # Standardized PR checklist for Aidan, Alexander, & Brendan
```

---

## ⚙️ How the Protection Works

- **Runs before the page.** The service worker registers `protector-main.js` in the page's main world at `document_start` with `chrome.scripting.registerContentScripts`, so hooks exist before any page script. Settings arrive synchronously through `content/cfg/<vector>.js` flag files and live through the bridge.
- **Tamper-resistant channel.** The bridge and the protector exchange a random nonce before page scripts run, so a page cannot forge messages to switch protections off.
- **Hard to detect.** Hooked functions keep their native `toString()`, name and length. Same-origin iframes, a classic bypass, are protected on first access and share the parent's noise seed so both give identical answers.
- **HTTP headers** are rewritten with `declarativeNetRequest` dynamic rules. While that shield is on, Chrome's "Preload pages" setting is turned off (`privacy` permission), because pages preloaded from Google search skipped the header rules. `If-None-Match` and `Cache-Control` are added by Chrome's cache after extensions run, so they cannot be removed.
- **Fonts** follow the most common profile for the OS. On Windows that is the default fonts plus the Microsoft Office pack, which tested far more common than a defaults-only list. Generated `@font-face` rules hide every other font (a face covering only `U+10FFFF` shadows the installed font) and emulate profile fonts the user lacks (`local("<font>")`, then a standard OS font). After editing `scripts/font-lists.json`, run `python scripts/generate_font_shield.py`.
- **Left unchanged on purpose:** the browser version, the navigator property list and the WebGL extension list are shared by everyone on the same browser version. Faking them made the browser *more* unique in testing (e.g. hiding 2 navigator properties dropped the value from 0.05% to 0.00% on amiunique.org). The popup explains these limits instead.

**Known limits:** Web Workers still see the real values, and Chrome-version-specific signals such as audio/video codec support and the browser version itself are left alone, because changing them would break sites or create inconsistencies.

---
