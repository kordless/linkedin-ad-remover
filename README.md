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

1. Clone or download this repo
2. Go to `chrome://extensions` and enable Developer mode
3. Click **Load unpacked** and select this folder
4. Open the extension popup and enter your Claude API key
5. Navigate to LinkedIn

## Requirements

- A Chromium browser (Chrome, Edge, Brave, Arc)
- A Claude API key from [console.anthropic.com](https://console.anthropic.com)

Typical cost: a few cents per browsing session.

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
