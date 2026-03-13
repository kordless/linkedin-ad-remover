# LinkedIn Ad Remover

A Chrome extension that uses Claude's vision API to identify and remove ads on LinkedIn.

## Why

LinkedIn changes its DOM constantly. Class names get hashed, ad containers get restructured, new promotional formats appear without warning. Static ad blockers play an arms race they can't win — every LinkedIn deploy breaks their hardcoded selectors, and someone has to manually update filter lists to catch up.

This extension sidesteps the arms race entirely. Instead of maintaining a list of selectors that rot over time, it sends a screenshot of your feed to Claude, who looks at the page the same way you do and says "that's an ad." When LinkedIn changes their markup, Claude still sees a box that says "Promoted" — no update needed.

## How It Works

1. **Instant static rules** — Known patterns (ad iframes, `[data-ad-banner]`, "Promoted" text labels, premium upsells) are nuked on page load before Claude even connects
2. **Vision analysis** — After the page settles, the extension screenshots your viewport and sends it to Claude with a DOM snapshot. Claude returns CSS selectors targeting ads
3. **Ctrl+click teaching** — Click any element Claude missed. It generalizes your selection into a reusable rule that catches similar ads across your feed
4. **Self-healing** — After applying rules, it re-screenshots the page. If something looks broken, it reverts the bad rule automatically
5. **Learning** — Rules persist across sessions with hit tracking, confidence scores, and 30-day auto-pruning. User-taught rules get top priority and never expire

## Privacy

Your Claude API key is stored in `chrome.storage.local`. It never leaves your browser except when sent directly to `api.anthropic.com`. There is no backend server, no proxy, no telemetry. Screenshots exist only for the duration of the API call and are not stored anywhere.

## Install

1. Download the latest **Source code (zip)** from [Releases](https://github.com/kordless/linkedin-ad-remover/releases)
2. Unzip it — you'll get a folder like `linkedin-ad-remover-1.0`
3. **Important:** Open that folder, then open the inner folder with the same name — you need the one that contains `manifest.json`, not the outer wrapper. GitHub's source zips nest the project inside two layers of folders.
4. Open Chrome (or Edge, Brave, Arc) and go to `chrome://extensions`
5. Toggle **Developer mode** on (top-right corner)
6. Click **Load unpacked** and select the **inner folder** (the one with `manifest.json` in it)
7. Click the extension icon in your toolbar to open the popup
8. Paste your Claude API key and click **Save**
9. Navigate to [linkedin.com](https://www.linkedin.com) — ads start disappearing within a few seconds

### Getting a Claude API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account (or sign in)
2. Navigate to **API Keys** and click **Create Key**
3. Copy the key (starts with `sk-ant-...`)
4. Paste it into the extension popup

Your key is stored locally in your browser and only ever sent to Anthropic's API. Typical cost is a few cents per browsing session.

### Using the Extension

Once installed and connected, the extension works automatically:

- **On page load** — built-in rules instantly hide known ad patterns (iframes, banners, "Promoted" labels). Then Claude scans the viewport and creates additional rules for anything the static rules missed.
- **Ctrl+click** — see an ad Claude didn't catch? Hold Ctrl and click it. The element flashes red, and Claude generalizes your click into a reusable rule. You'll see a toast: "Element marked — Claude is learning..."
- **Undo** — open the popup to see all active rules. Click **Undo** next to any rule to restore the hidden element. Useful for accidental clicks or if you want to peek at what was removed.
- **Wide Feed** — toggle in the popup to hide both sidebars and center your feed at a comfortable reading width.
- **Re-scan** — hit the Re-scan button in the popup to have Claude re-analyze the current page.
- **Full Reset** — clears all learned rules, stats, and errors. Your API key is preserved.

### Updating

When a new release is available, download the new zip from [Releases](https://github.com/kordless/linkedin-ad-remover/releases), unzip it, navigate into the inner folder (the one with `manifest.json`), and click the reload button on `chrome://extensions`. Your saved rules and API key persist in Chrome's storage — they're not inside the extension folder.

## Requirements

- A Chromium browser (Chrome, Edge, Brave, Arc)
- A Claude API key from [console.anthropic.com](https://console.anthropic.com)

## Features

- **Claude vision analysis** — identifies ads by appearance, not brittle selectors
- **Ctrl+click to teach** — point at what Claude missed, it learns
- **Self-healing** — detects and reverts rules that break the page
- **16 built-in static rules** — instant removal of obvious ad patterns
- **"Promoted" text scanner** — finds and hides sponsored posts by label text
- **Wide feed mode** — hides sidebars and centers your feed
- **Rule management** — undo individual rules, clear all, full reset
- **Cost tracking** — estimated API spend shown in the popup

## Site

The landing page at [linkedin.nuts.services](https://linkedin.nuts.services) is in the `site/` directory. It's a static Express app deployed on Cloud Run.
