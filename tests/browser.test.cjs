// Real extension, real Chrome APIs, isolated profile, synthetic Twitch page/cookies.
// No network requests are allowed through to Twitch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.qa');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <main><h1>Twitch test fixture</h1></main>
  <div data-test-selector="user-menu-dropdown__main-menu" style="width:280px;background:#18181b;color:#eee;padding:8px">
    <div><a data-test-selector="user-menu-dropdown__channel-link" href="#">Channel</a></div>
  </div></body></html>`;
const future = Math.floor(Date.now() / 1000) + 86400;
const cookiesFor = (login, token = login) => [
  { name: 'auth-token', value: token, domain: '.twitch.tv', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: future },
  { name: 'login', value: login, domain: '.twitch.tv', path: '/', secure: true, httpOnly: false, sameSite: 'Lax', expires: future },
];

(async () => {
  let context;
  let checks = 0;
  const errors = [];
  const check = message => { checks++; console.log(`PASS ${message}`); };
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', viewport: { width: 340, height: 600 }, colorScheme: 'dark',
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (url.hostname === 'www.twitch.tv' || url.hostname === 'twitch.tv') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
      }
      return route.abort();
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const popup = await context.newPage();
    const capture = async filename => {
      const height = Math.ceil(await popup.evaluate(() => document.body.getBoundingClientRect().height));
      assert.ok(height <= 600, 'popup fits Chrome’s height limit');
      await popup.setViewportSize({ width: 340, height });
      await popup.screenshot({ path: path.join(output, filename), fullPage: true });
    };
    const message = (type, payload = {}) => popup.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.getByRole('button', { name: 'Connect your first account' }).waitFor();
    check('extension loads with empty onboarding');
    assert.equal((await message('GET_STATE')).ok, true);
    assert.equal(await popup.evaluate(() => document.querySelector('link[href*="http"]')), null);

    await context.addCookies(cookiesFor('alice'));
    await popup.reload();
    await popup.getByRole('button', { name: 'Save current account', exact: true }).click();
    await popup.getByRole('heading', { name: 'alice', exact: true }).waitFor();
    assert.ok(await popup.evaluate(() => document.body.getBoundingClientRect().height <= 600), 'popup fits Chrome’s 600px height limit');
    check('current account captured without creating or filling a slot');
    const alice = (await message('GET_STATE')).slots[0];
    assert.equal(alice.login, 'alice');
    assert.equal(alice.cookies, undefined);

    await popup.getByRole('button', { name: 'Connect another account' }).click();
    await popup.getByText('Waiting for you to sign in…').waitFor();
    assert.equal((await context.cookies('https://www.twitch.tv/')).some(c => c.name === 'auth-token'), false);
    assert.equal(await popup.getByRole('button', { name: 'Save signed-in account' }).isDisabled(), true);
    await capture('popup-login.png');
    // Close the popup during login, then come back in a new extension page.
    await popup.goto('about:blank');
    await context.addCookies(cookiesFor('bob'));
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.getByText('Session found · @bob').waitFor();
    await popup.getByRole('button', { name: 'Save signed-in account' }).click();
    await popup.getByRole('heading', { name: 'bob', exact: true }).waitFor();
    const bob = (await message('GET_STATE')).slots.find(slot => slot.login === 'bob');
    check('guided login survives a closed popup and saves a second account');

    const twitch = context.pages().find(page => page.url().includes('twitch.tv')) || await context.newPage();
    await twitch.goto('https://www.twitch.tv/example');
    await twitch.locator('#switchr-widget').waitFor();
    await twitch.getByRole('button', { name: 'Switch to alice' }).click();
    await twitch.waitForFunction(() => document.querySelector('.switchr-widget-row.active .switchr-widget-name')?.textContent === 'alice');
    const current = await context.cookies('https://www.twitch.tv/');
    assert.equal(current.find(c => c.name === 'auth-token').value, 'alice');
    check('Twitch widget switches accounts using actual cookies and tab reload');
    await popup.reload();
    await popup.getByRole('heading', { name: 'alice', exact: true }).waitFor();
    assert.equal(await popup.getByRole('heading', { name: 'alice', exact: true }).count(), 1);
    assert.equal(await popup.getByText('Saved just now', { exact: true }).count(), 0);
    assert.ok(await popup.evaluate(() => document.body.getBoundingClientRect().height < 400), 'two accounts fit a compact popup');
    await capture('popup-dark.png');

    // Partitioned cookie plus host-only cookie: exercise Chrome's real metadata API.
    await worker.evaluate(async () => {
      await chrome.cookies.set({ url: 'https://www.twitch.tv/', name: 'partition-test', value: 'alice-partition',
        secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } });
      await chrome.cookies.set({ url: 'https://www.twitch.tv/', name: 'host-only-test', value: 'alice-host', secure: true });
    });
    await message('GET_STATE');
    assert.equal((await message('SWITCH_TO_SLOT', { slotId: bob.id })).ok, true);
    assert.equal((await message('SWITCH_TO_SLOT', { slotId: alice.id })).ok, true);
    const metadata = await worker.evaluate(async () => ({
      partition: await chrome.cookies.get({ url: 'https://www.twitch.tv/', name: 'partition-test',
        partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } }),
      host: await chrome.cookies.get({ url: 'https://www.twitch.tv/', name: 'host-only-test' }),
    }));
    assert.equal(metadata.partition?.value, 'alice-partition');
    assert.equal(metadata.partition?.partitionKey.hasCrossSiteAncestor, true);
    assert.equal(metadata.host?.hostOnly, true);
    check('partitioned and host-only cookie metadata survive a round trip in Chromium');

    // Failed restoration must roll back, including a partial target snapshot.
    await worker.evaluate(async slotId => {
      const { slots } = await chrome.storage.local.get('slots');
      slots.find(slot => slot.id === slotId).cookies.push({ name: 'broken', value: 'x', domain: 'not-twitch.invalid',
        path: '/', secure: true, httpOnly: false, sameSite: 'lax', hostOnly: true, session: true, storeId: '0' });
      await chrome.storage.local.set({ slots });
    }, bob.id);
    assert.equal((await message('SWITCH_TO_SLOT', { slotId: bob.id })).error, 'SWITCH_FAILED');
    assert.equal((await message('GET_STATE')).activeSlotId, alice.id);
    assert.equal((await context.cookies('https://www.twitch.tv/')).find(c => c.name === 'auth-token').value, 'alice');
    check('real Chrome cookie API failure restores the previous account');
    await worker.evaluate(async slotId => {
      const { slots } = await chrome.storage.local.get('slots');
      const slot = slots.find(slot => slot.id === slotId);
      slot.cookies = slot.cookies.filter(c => c.name !== 'broken');
      await chrome.storage.local.set({ slots });
    }, bob.id);

    await popup.reload();
    await popup.getByRole('button', { name: 'Manage bob', exact: true }).click();
    await popup.locator('article').filter({ has: popup.getByRole('heading', { name: 'bob', exact: true }) }).getByRole('button', { name: 'Sign in again' }).click();
    await popup.getByRole('heading', { name: 'Sign in to bob' }).waitFor();
    await context.addCookies(cookiesFor('charlie'));
    assert.equal((await message('COMPLETE_LOGIN')).error, 'ACCOUNT_MISMATCH');
    await popup.reload();
    await popup.getByText('This session is @charlie. Sign in as @bob.').waitFor();
    assert.equal(await popup.getByRole('button', { name: 'Save signed-in account' }).isDisabled(), true);
    await capture('popup-wrong-account.png');
    await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await popup.getByRole('heading', { name: 'alice', exact: true }).waitFor();
    assert.equal((await context.cookies('https://www.twitch.tv/')).find(c => c.name === 'auth-token').value, 'alice');
    check('wrong-account reauthentication is rejected; cancellation restores original cookies');

    await popup.getByRole('button', { name: 'Manage alice', exact: true }).click();
    const aliceCard = popup.locator('article').filter({ has: popup.getByRole('heading', { name: 'alice', exact: true }) });
    await aliceCard.getByRole('button', { name: 'Rename', exact: true }).click();
    await popup.getByRole('textbox', { name: 'Account name' }).fill('<img src=x onerror=alert(1)>');
    await popup.getByRole('button', { name: 'Save name', exact: true }).click();
    await popup.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor();
    assert.equal(await popup.locator('main img').count(), 0);
    const updated = popup.locator('article').filter({ has: popup.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }) });
    await updated.getByRole('button', { name: 'Manage' }).click();
    await updated.getByRole('button', { name: 'Remove', exact: true }).click();
    await updated.getByRole('button', { name: 'Keep account', exact: true }).click();
    assert.equal((await message('GET_STATE')).slots.length, 2);
    check('rename escapes HTML and account removal has a working cancellation');

    assert.equal((await message('RENAME_SLOT', { slotId: alice.id, label: 'Streaming' })).ok, true);
    await popup.reload();
    await popup.getByRole('heading', { name: 'Streaming', exact: true }).waitFor();

    await popup.getByRole('button', { name: 'Use light theme' }).click();
    assert.equal(await popup.evaluate(() => document.body.dataset.theme), 'light');
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > 340), false);
    await capture('popup-light.png');
    await popup.reload();
    assert.equal(await popup.evaluate(() => document.body.dataset.theme), 'light');
    check('light theme persists and long names do not cause horizontal overflow');

    // Storage restriction must hold in an actual Twitch content-script context.
    const cdp = await context.newCDPSession(twitch);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    let extensionWorld;
    for (const world of worlds) {
      const result = await cdp.send('Runtime.evaluate', { contextId: world.id,
        expression: 'globalThis.chrome?.runtime?.id', returnByValue: true });
      if (result.result.value === id) extensionWorld = world;
    }
    assert.ok(extensionWorld, 'Twitch content-script world exists');
    const restricted = await cdp.send('Runtime.evaluate', { contextId: extensionWorld.id, awaitPromise: true,
      expression: 'chrome.storage.local.get("slots").then(() => false, () => true)', returnByValue: true });
    assert.equal(restricted.result.value, true, 'content script cannot read session storage');
    const metadataState = await cdp.send('Runtime.evaluate', { contextId: extensionWorld.id, awaitPromise: true,
      expression: 'chrome.runtime.sendMessage({type:"GET_STATE"})', returnByValue: true });
    assert.equal(metadataState.result.value.ok, true);
    assert.equal(metadataState.result.value.slots[0].cookies, undefined);
    await cdp.detach();
    check('Twitch content script cannot read stored credentials and receives only metadata');
    await context.clearCookies();
    await popup.reload();
    await popup.getByRole('heading', { name: 'You’re signed out.' }).waitFor();
    assert.equal((await message('GET_STATE')).activeSlotId, null);
    check('logout is reflected accurately without falling back to a saved account');

    // Mixed session states and a longer account list must remain usable in a popup.
    await worker.evaluate(async () => {
      const { slots } = await chrome.storage.local.get('slots');
      const template = slots.find(slot => slot.login === 'bob');
      const copy = (id, label) => ({ ...structuredClone(template), id, label, login: id,
        cookies: template.cookies.map(c => ({ ...c, value: c.name === 'auth-token' ? `fake-${id}` : c.name === 'login' ? id : c.value })) });
      const expired = copy('expired', 'Old account');
      expired.cookies = expired.cookies.map(c => ({ ...c, expirationDate: 1, session: false }));
      const empty = { id: 'empty', label: 'Unconnected', savedAt: null, cookies: [] };
      await chrome.storage.local.set({ slots: [...slots, expired, empty,
        ...Array.from({ length: 8 }, (_, i) => copy(`extra${i}`, `An account name long enough to truncate ${i}`))] });
    });
    await popup.reload();
    await popup.getByRole('heading', { name: 'Old account', exact: true }).waitFor();
    assert.equal(await popup.getByRole('button', { name: 'Sign in to Old account', exact: true }).isEnabled(), true);
    assert.equal(await popup.getByRole('button', { name: 'Sign in to Unconnected', exact: true }).isEnabled(), true);
    assert.ok(await popup.evaluate(() => document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight));
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > 340), false);
    await capture('popup-many-accounts.png');
    await popup.getByRole('button', { name: 'Sign in to Old account', exact: true }).click();
    await popup.getByRole('heading', { name: 'Sign in to Old account', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await popup.getByRole('heading', { name: 'You’re signed out.' }).waitFor();
    check('expired and empty sessions have sign-in actions; long lists scroll inside the popup');

    // A background update should not dismiss account management while it is open.
    await popup.getByRole('button', { name: 'Manage bob', exact: true }).click();
    await worker.evaluate(async id => {
      const { slots } = await chrome.storage.local.get('slots');
      slots.find(slot => slot.id === id).label = 'Secondary';
      await chrome.storage.local.set({ slots });
    }, bob.id);
    await popup.getByRole('heading', { name: 'Secondary', exact: true }).waitFor();
    assert.equal(await popup.getByRole('button', { name: 'Manage Secondary', exact: true }).getAttribute('aria-expanded'), 'true');
    await popup.getByRole('button', { name: 'Rename', exact: true }).focus();
    await popup.keyboard.press('Escape');
    assert.equal(await popup.getByRole('button', { name: 'Manage Secondary', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await popup.getByRole('button', { name: 'Manage Secondary', exact: true }).evaluate(el => el === document.activeElement), true);
    check('management survives background refreshes and Escape returns focus to its trigger');

    // Display actual failures in the compact layout without covering the controls.
    await worker.evaluate(async id => {
      const { slots } = await chrome.storage.local.get('slots');
      slots.find(slot => slot.id === id).cookies.push({ name: 'broken', value: 'x', domain: 'not-twitch.invalid',
        path: '/', secure: true, httpOnly: false, sameSite: 'lax', hostOnly: true, session: true, storeId: '0' });
      await chrome.storage.local.set({ slots });
    }, bob.id);
    await popup.getByRole('button', { name: 'Switch to Secondary', exact: true }).click();
    await popup.getByRole('alert').filter({ hasText: 'Your previous cookies were restored' }).waitFor();
    await popup.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') === 'false');
    assert.equal(await popup.getByRole('button', { name: 'Switch to Secondary', exact: true }).isEnabled(), true);
    await capture('popup-error.png');
    const positions = await popup.evaluate(() => ({ notice: document.getElementById('toast').getBoundingClientRect().bottom,
      footer: document.querySelector('footer').getBoundingClientRect().top }));
    assert.ok(positions.notice <= positions.footer, 'feedback does not cover the footer controls');
    check('switch errors remain visible and actionable within the popup height limit');

    assert.deepEqual(errors, []);
    console.log(`${checks} browser scenarios passed. No Twitch network traffic; no page errors.`);
  } finally {
    await context?.close();
    // Only delete this script's unique, resolved profile inside the QA directory.
    if (path.dirname(profile) === output) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
