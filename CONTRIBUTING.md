# Team Collaboration Guide — CS-550 Research Project

**Team Members:**
- Aidan Gillen
- Alexander Torino
- Brendan Tierney

---

## 1. Adding Teammates on GitHub

Once this repository is pushed to GitHub, the repository owner can invite teammates either via the GitHub web interface or the GitHub CLI (`gh`):

### Option A: Via GitHub Website
1. Go to your repository on GitHub.
2. Click **Settings** → **Collaborators** (in the left sidebar).
3. Click **Add people** and enter your teammates' GitHub usernames or school email addresses.

### Option B: Via GitHub CLI (`gh`)
```bash
gh api repos/:owner/:repo/collaborators/TEAMMATE_GITHUB_USERNAME -X PUT -f permission=push
```

---

## 2. Cloning & Local Development Setup

Each teammate should run the following once on their computer:

```bash
# 1. Clone the repository
git clone https://github.com/AtlasUnbound/cs550-finalproject-browser-extension.git
cd cs550-finalproject-browser-extension

# 2. Load the extension in Chrome
# Open chrome://extensions -> Enable "Developer mode" -> Click "Load unpacked" -> Select this folder
```

### Reloading Changes in Chrome
- **Popup HTML/CSS/JS changes (`popup/`):** Simply close and re-open the extension popup!
- **Content script or Service Worker changes (`content/`, `background/`, `manifest.json`):** Click the **Reload (⟳)** icon on the PrintShield card at `chrome://extensions`, then refresh your test webpage.

---

## 3. Branching & Pull Request Workflow

To avoid merge conflicts while all three teammates work in parallel:

1. **Always pull the latest `main` before starting work:**
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Create a descriptive feature branch:**
   ```bash
   git checkout -b feat/canvas-noise-tuning
   # or: git checkout -b ui/tooltip-copy-updates
   # or: git checkout -b study/qualtrics-export
   ```
3. **Stage, commit, and push your branch:**
   ```bash
   git add .
   git commit -m "Improve Canvas 2D tooltip explanation for novice users"
   git push -u origin feat/canvas-noise-tuning
   ```
4. **Open a Pull Request on GitHub:**
   - GitHub Actions CI (`.github/workflows/ci.yml`) will automatically verify that `manifest.json` is valid, all required icons exist, and there are no JavaScript syntax errors.
   - Have at least one teammate review and merge into `main`.
