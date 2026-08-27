# Obsidian Terminal Setup — Implementation Plan

> **Release status (2026-08-28):** Out of scope for the framework (personal vault theming); excluded from the release. Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an Obsidian vault with integrated terminal that replicates macOS Terminal.app aesthetics — Red Sands theme with translucency, SF Mono font at smaller size (9pt).

**Architecture:** Obsidian vault with Terminal community plugin, custom CSS for Red Sands color scheme, macOS window translucency via Appearance settings, font override via CSS snippet.

**Tech Stack:** Obsidian (latest), Terminal plugin, CSS custom theme snippet, macOS system settings.

---

## Prerequisites

- [ ] macOS with Obsidian installed (or install from https://obsidian.md)
- [ ] Terminal.app with Red Sands theme confirmed working

---

## Task 1: Create Obsidian Vault

**Files:** N/A (UI actions in Obsidian)

**Steps:**
- [ ] Open Obsidian app
- [ ] Click "Create new vault"
- [ ] Name: `org-os-terminal`
- [ ] Location: `~/Documents/Obsidian Vault/org-os-terminal`
- [ ] Click "Create"

**Verification:**
```bash
ls -la ~/Documents/Obsidian\ Vault/org-os-terminal/
# Should show: .obsidian/ folder created
```

---

## Task 2: Install Terminal Plugin

**Files:** N/A (community plugin installation)

**Steps:**
- [ ] In Obsidian, open Settings (⌘,)
- [ ] Go to "Community plugins"
- [ ] Turn off "Safe mode" (if enabled)
- [ ] Click "Browse"
- [ ] Search for "Terminal"
- [ ] Install "Terminal" by polyipseity
- [ ] Enable the plugin
- [ ] Review the plugin's settings page

**Verification:**
- Command palette (⌘P) → type "Terminal: Open terminal" → should show option

---

## Task 3: Configure Red Sands Color Scheme via CSS Snippet

**Files:** 
- Create: `~/Documents/Obsidian Vault/org-os-terminal/.obsidian/snippets/red-sands-terminal.css`

**Steps:**
- [ ] Create CSS snippets directory if not exists
- [ ] Create the CSS file with Red Sands theme colors

**File content:**
```css
/* Red Sands Terminal Theme for Obsidian Terminal Plugin */
/* Based on macOS Terminal.app Red Sands theme */

.terminal-view .terminal {
  --terminal-background: #7c3a3a !important;
  --terminal-foreground: #f2d6b6 !important;
  --terminal-cursor: #ffdab9 !important;
  --terminal-selection: rgba(255, 218, 185, 0.3) !important;
  
  /* ANSI Colors matching Red Sands */
  --terminal-color-0: #2a1f1f !important;   /* Black */
  --terminal-color-1: #ff6b6b !important;   /* Red */
  --terminal-color-2: #90ee90 !important;   /* Green */
  --terminal-color-3: #f4a460 !important;   /* Yellow/Brown */
  --terminal-color-4: #87ceeb !important;   /* Blue */
  --terminal-color-5: #dda0dd !important;   /* Magenta */
  --terminal-color-6: #20b2aa !important;   /* Cyan */
  --terminal-color-7: #f2d6b6 !important;   /* White */
  
  /* Bright variants */
  --terminal-color-8: #5c4a4a !important;   /* Bright Black */
  --terminal-color-9: #ff9999 !important;   /* Bright Red */
  --terminal-color-10: #b3ffb3 !important;  /* Bright Green */
  --terminal-color-11: #ffcc99 !important;  /* Bright Yellow */
  --terminal-color-12: #b3e0ff !important;  /* Bright Blue */
  --terminal-color-13: #e6b3e6 !important;  /* Bright Magenta */
  --terminal-color-14: #66cdaa !important;  /* Bright Cyan */
  --terminal-color-15: #fff8dc !important;  /* Bright White */
}

/* SF Mono font at smaller size (9pt vs your Terminal.app 11pt) */
.terminal-view .terminal {
  font-family: "SF Mono", "SFMono-Regular", Monaco, "Courier New", monospace !important;
  font-size: 9pt !important;
  line-height: 1.4 !important;
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
}

/* Translucent background effect */
.terminal-view {
  background-color: rgba(124, 58, 58, 0.85) !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
}

/* Terminal cursor styling */
.terminal-view .terminal .xterm-cursor {
  background-color: #ffdab9 !important;
  color: #7c3a3a !important;
}

/* Selection styling */
.terminal-view .terminal .xterm-selection div {
  background-color: rgba(255, 218, 185, 0.4) !important;
}
```

**Verification:**
```bash
cat ~/Documents/Obsidian\ Vault/org-os-terminal/.obsidian/snippets/red-sands-terminal.css | head -10
```

---

## Task 4: Enable CSS Snippet in Obsidian

**Files:** N/A (UI settings)

**Steps:**
- [ ] In Obsidian, open Settings (⌘,)
- [ ] Go to "Appearance"
- [ ] Scroll to "CSS snippets"
- [ ] Toggle ON "red-sands-terminal"
- [ ] Close settings

**Verification:**
- CSS snippet shows as enabled with checkmark

---

## Task 5: Configure Terminal Plugin Settings

**Files:** N/A (plugin settings UI)

**Steps:**
- [ ] Open Settings (⌘,)
- [ ] Go to "Community plugins" → "Terminal"
- [ ] Set preferred shell: `/bin/zsh` (or your default)
- [ ] Enable "Integrate with Obsidian theme" (if available)
- [ ] Set terminal rows: 24
- [ ] Set terminal columns: 80
- [ ] Close settings

**Verification:**
- Open terminal (⌘P → "Terminal: Open terminal") → should open with Red Sands colors

---

## Task 6: Enable macOS Window Translucency

**Files:** N/A (macOS system settings)

**Steps:**
- [ ] Open Obsidian → Settings → Appearance
- [ ] Enable "Translucent window" toggle (near top)
- [ ] Optionally adjust opacity in macOS System Settings:
  - System Settings → Accessibility → Display → "Reduce transparency" (make sure this is OFF)

**Verification:**
- Obsidian window background should show slight transparency/blur

---

## Task 7: Test Terminal Appearance

**Files:** N/A (manual testing)

**Steps:**
- [ ] Open command palette (⌘P)
- [ ] Type "Terminal: Open terminal"
- [ ] Press Enter
- [ ] Compare side-by-side with Terminal.app (Red Sands):
  - Background color: warm reddish-brown (#7c3a3a)
  - Text color: cream/beige (#f2d6b6)
  - Font: SF Mono, noticeably smaller than Terminal.app (9pt vs 11pt)
  - Window: slightly translucent with blur

**Verification:**
- [ ] Run `ls -la` in both terminals — colors should match
- [ ] Run `echo $SHELL` — should show same shell as Terminal.app
- [ ] Font size visually smaller than your current Terminal.app window

---

## Task 8: Create Quick-Access Hotkey

**Files:** N/A (Obsidian hotkey settings)

**Steps:**
- [ ] Open Settings (⌘,)
- [ ] Go to "Hotkeys"
- [ ] Search for "Terminal"
- [ ] Find "Terminal: Open terminal"
- [ ] Click to add hotkey
- [ ] Press: ⌃⌘T (Control-Command-T)
- [ ] Close settings

**Verification:**
- Press ⌃⌘T → terminal should open instantly

---

## Task 9: Document Setup in Vault

**Files:**
- Create: `~/Documents/Obsidian Vault/org-os-terminal/README.md`

**Steps:**
- [ ] Create README with setup notes

**File content:**
```markdown
# org-os Terminal Vault

Obsidian vault configured with integrated terminal matching macOS Terminal.app aesthetics.

## Setup Details

- **Theme:** Red Sands (warm reddish-brown background, cream text)
- **Font:** SF Mono 9pt (smaller than Terminal.app's 11pt)
- **Translucency:** Enabled via macOS + CSS backdrop-filter
- **Hotkey:** ⌃⌘T to open terminal

## Color Reference

| Element | Color | Hex |
|---------|-------|-----|
| Background | Warm brown | `#7c3a3a` |
| Foreground | Cream | `#f2d6b6` |
| Cursor | Peach | `#ffdab9` |

## Files

- `.obsidian/snippets/red-sands-terminal.css` — Theme styling
- `.obsidian/community-plugins.json` — Plugin list

## Usage

1. Press ⌃⌘T to open terminal
2. Run any shell command
3. Terminal uses same shell as Terminal.app (`/bin/zsh`)
```

**Verification:**
```bash
cat ~/Documents/Obsidian\ Vault/org-os-terminal/README.md
```

---

## Task 10: Final Verification & Comparison

**Steps:**
- [ ] Open Terminal.app with Red Sands theme
- [ ] Open Obsidian terminal (⌃⌘T)
- [ ] Arrange side-by-side
- [ ] Run `ls -la --color=auto` in both
- [ ] Verify:
  - [ ] Background colors match (warm reddish-brown)
  - [ ] Text colors match (cream/beige)
  - [ ] Font family matches (SF Mono)
  - [ ] Font size is smaller in Obsidian (9pt vs 11pt)
  - [ ] Obsidian has translucency/blur effect

**Acceptance Criteria:**
- Visual appearance matches Terminal.app Red Sands within 95%
- Font is noticeably smaller (as requested)
- Window has translucency effect
- Hotkey works reliably

---

## Troubleshooting

### Colors don't match exactly
- Adjust hex values in `red-sands-terminal.css`
- Use Digital Color Meter app to sample Terminal.app colors

### Font doesn't look right
- Install SF Mono if not available: `brew install --cask sf-symbols`
- Or change CSS to use Monaco as fallback

### No translucency
- Check macOS System Settings → Accessibility → Display
- Ensure "Reduce transparency" is OFF
- Try different opacity values in CSS (0.85 → 0.75, etc.)

---

## Next Steps (Optional)

- [ ] Integrate with org-os: symlink `data/` folder into vault
- [ ] Create canvas dashboard for visual org-os overview
- [ ] Add template for daily notes matching Zettelkasten format

---

Plan complete. Ready for execution.
