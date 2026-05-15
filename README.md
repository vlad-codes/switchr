# Switchr — Twitch Account Switcher

Switch between multiple Twitch accounts instantly — from the browser popup or the widget built into twitch.tv.

## Installation

Switchr is not on the Chrome Web Store. Install it manually:

1. Download the latest ZIP from [Releases](../../releases) and unpack it
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the unpacked folder

The Switchr icon will appear in your toolbar.

Works on Chrome and any Chromium-based browser (Brave, Edge, Arc).

## How it works

1. Log into Twitch with your first account
2. Open Switchr, add a slot, click **update token** to save the session
3. Log into Twitch with your second account, add another slot and save
4. Click **switch** to jump between accounts instantly

Switchr saves Twitch session cookies per slot and swaps them on switch. All data stays in your browser — no servers, no sign-up.

## Privacy

Switchr stores session cookies locally via the Chrome Storage API. Nothing leaves your device. See [docs/privacy.html](docs/privacy.html) for the full privacy policy.

## License

MIT
