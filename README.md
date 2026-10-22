# PrintShield: Digital Fingerprint Visualizer & Mitigator

**Course:** CS-550 (Professor Albayram)  
**Research Team:** Aidan Gillen, Alexander Torino, Brendan Tierney  

---

## 📖 Project Overview

As users become more aware of online tracking methods like cookies and digital fingerprinting, the mechanics behind browser fingerprinting remain opaque to most people. Existing anti-fingerprinting tools often cater to technical users, break site usability, or omit the educational elements needed for users to build accurate mental models of their online privacy.

**PrintShield** is a human-centric Manifest V3 Chromium browser extension built for our CS-550 research study that:
1. **Detects & Visualizes Digital Footprint Vectors** in real time as websites call fingerprinting APIs.
2. **Educates Users** via plain-language *"Why this matters"* drawers detailing what trackers learn, how mitigations work, and potential site compatibility trade-offs.
3. **Mitigates Fingerprinting** with per-vector or one-click toggles that spoof or generalize hardware and rendering signatures (focusing on **Canvas 2D** and **User-Agent / Navigator** properties alongside WebGL, Web Audio, and Font metrics).
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
3. Click **Run All Fingerprint Probes** on the Test Lab page, then re-open the PrintShield popup to inspect the detected fingerprinting calls.

### Task 2: Understanding Fingerprints
1. Inside the PrintShield popup, inspect the five fingerprinting vectors:
   - **Canvas 2D Rendering** *(Core Vector — 30% weight)*
   - **User-Agent & Navigator** *(Core Vector — 30% weight)*
   - **WebGL & GPU Hardware** *(15% weight)*
   - **Web Audio Context** *(15% weight)*
   - **Font Enumeration & Metrics** *(10% weight)*
2. Click **"Why this matters ▼"** on each vector to read what information it reveals to trackers, how PrintShield mitigates it, and its site compatibility rating.

### Task 3: Mitigation Testing
1. Toggle on individual vector mitigations (or click **Enable Recommended Shield**).
2. Observe the dynamic change in the **Footprint Protection Score** ring and status badge.
3. Return to the **Test Lab** tab and click **Run All Fingerprint Probes** again—notice how the Canvas hash changes and Navigator properties are generalized (`Win32`, `4 Logical Cores / 8 GB RAM`).
4. Browse 2–3 standard websites (news sites, media sites, etc.) to evaluate browsing usability and check for any site degradation.

---

## 🗂️ Repository Architecture

```text
finalbroswerproject/
├── manifest.json                 # Manifest V3 extension configuration
├── background/
│   └── service-worker.js         # Ephemeral MV3 service worker (badge, score, session state)
├── content/
│   ├── bridge.js                 # Isolated-world content script (storage sync & message relay)
│   └── protector-main.js         # Main-world API interceptor & spoofer (Canvas, UA, Audio, WebGL, Fonts)
├── popup/
│   ├── popup.html                # Extension popup dashboard UI
│   ├── popup.css                 # Responsive dark-mode styling & SVG score ring
│   └── popup.js                  # Dashboard logic, educational tooltips, toggle handlers
├── sandbox/
│   ├── test-lab.html             # Interactive fingerprinting test page for study participants
│   ├── test-lab.css              # Test Lab stylesheet
│   └── test-lab.js               # Live probes for Canvas, Navigator, WebGL, Audio, and Fonts
├── icons/                        # Extension icons (16x16, 48x48, 128x128 PNGs)
├── scripts/
│   └── generate_icons.ps1        # Icon generation utility script
└── .github/
    ├── workflows/ci.yml          # Automated Manifest V3 & JS syntax validation on push/PR
    └── pull_request_template.md  # Standardized PR checklist for Aidan, Alexander, & Brendan
```

---

## 🤝 Team Collaboration Guide

See [CONTRIBUTING.md](./CONTRIBUTING.md) for our Git workflow, branch naming conventions, and instructions for adding Aidan Gillen, Alexander Torino, and Brendan Tierney as GitHub collaborators.
