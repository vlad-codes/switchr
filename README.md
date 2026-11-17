# Switchr — Twitch Account Switcher

Switch between saved Twitch accounts from your browser toolbar or Twitch profile menu. Sessions and account names stay in your browser; there is no backend or separate sign-up.

## Install or update

For Chromium, use Chrome 130+ or a compatible Chromium browser (Edge, Brave, Arc). Incognito is not supported because it has a separate cookie store.

1. Download and unpack the extension, or use this repository folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin Switchr in your toolbar.

For an existing unpacked installation, use **Reload** on its extension card, then reload Twitch tabs. Keep the same installation and folder to retain saved accounts. Existing 1.0 slots are read directly; no migration or reinstallation is needed.

### Firefox

Firefox 128+ desktop supports temporary installation from the repository. Open
`about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and
choose `manifest.json`. Firefox removes temporary add-ons on restart. Ordinary
persistent installation requires a Mozilla-signed package.

Switchr manages Twitch accounts in Firefox’s default cookie store. Container
tabs and private windows use separate sessions.

## Connect accounts

- **Already signed in to Twitch?** Open Switchr and choose **Save current account**. The account name is detected from Twitch’s login cookie when available.
- **Starting fresh?** Choose **Connect your first account**, sign in on Twitch (including 2FA), then reopen Switchr and choose **Save signed-in account**.
- **Add another account:** Choose **Connect another account**. Switchr first saves your current account and then opens a fresh Twitch login. Sign in, return to Switchr, and save. You can close the popup during this flow.
- **Change your mind?** Choose **Cancel** to restore the browser session you had before starting the login.

Use **Switch** for a saved account. Twitch tabs in the default cookie store share cookies and reload together. Switchr does not provide simultaneous account isolation; use separate browser profiles for that.

## Session recovery

**Manage → Sign in again** opens a guided login for a saved account. Switchr checks the account’s login cookie before replacing its saved session. **Rename** changes only its label. **Remove** deletes the saved copy without logging out the account currently open on Twitch.

Known sessions are refreshed when their cookies change and immediately before switching away. If Twitch rotates the auth token or you sign in manually, Switchr shows an unsaved current session; **Save current account** updates the matching account rather than silently discarding that login.

Use Switchr to connect another account instead of Twitch’s **Log Out** button. Logging out on Twitch may revoke a token, so restoring an older cookie may no longer authenticate. Expiration, revocation, password changes and Twitch security checks can still require a real login. The “Saved” badge means a local cookie is present and not expired; it is not server-side validation.

The extension checks the target session before clearing current cookies. If restoring cookies fails, it rolls back to the previous cookies. A local recovery journal also preserves the backup if a worker stops during a swap; recovery retries on browser startup or the next popup/widget request. A tab reload failure is reported separately from a successful cookie switch.

Old slots without account identity can still be switched to if their cookies have not expired. If an identity cannot be recovered, save a fresh login as a new account and remove the old entry.

## Privacy

Twitch session cookies are credentials. Switchr uses protected extension storage in Chromium and extension-origin IndexedDB in Firefox, and sends only account metadata to its Twitch content script. They are not uploaded, synced or exported. The popup uses system fonts and has no remote assets. Browser extension storage is not a separate encrypted vault. See [the privacy policy](docs/privacy.html).

## Development and verification

No build step or runtime packages are needed to load the extension. Node.js 20+ is needed for checks; Playwright is only a development dependency.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` performs syntax checks and 22 Node tests for session capture, account identity, expiry, rollback, crash recovery, serialization, sender restrictions and legacy slots.

The browser suite loads the real extension in a unique temporary Chromium profile and uses synthetic cookies plus a local Twitch page fixture. All external HTTP requests are blocked. It covers the actual cookie API, popup and widget flows, cancellation, storage restrictions, themes and layout. Screenshots are written to `.qa/`; the test profile is deleted on exit. It does not test real Twitch authentication or the live profile-menu selectors.

Run `python tests/firefox.test.py` to verify saving, connecting and switching two accounts with synthetic cookies in a temporary Firefox profile. Set `FIREFOX_BINARY` if Firefox is outside your PATH.

## License

MIT
