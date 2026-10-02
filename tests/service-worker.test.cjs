const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = readFileSync(require('node:path').join(__dirname, '../background/service-worker.js'), 'utf8');
const clone = value => structuredClone(value);
const cookie = (name, value, extra = {}) => ({
  name, value, domain: '.twitch.tv', path: '/', secure: true, httpOnly: false,
  sameSite: 'lax', session: false, expirationDate: Date.now() / 1000 + 86400,
  hostOnly: false, storeId: '0', ...extra,
});
const session = (login, token = login) => [cookie('auth-token', token, { httpOnly: true }), cookie('login', login)];
const slot = (id, cookies, extra = {}) => ({ id, label: id, cookies, savedAt: Date.now(), ...extra });

function harness({ storage = {}, cookies = [], failSet, failRemove, failStorage, tabFailure } = {}) {
  const data = clone(storage);
  let jar = clone(cookies);
  let listener;
  let cookieListener;
  const calls = { set: [], remove: [], reload: [], create: [], access: [], writes: 0 };
  const chrome = {
    storage: { local: {
      setAccessLevel: async details => { calls.access.push(clone(details)); },
      get: async () => clone(data),
      set: async updates => {
        if (failStorage?.(updates)) throw new Error('quota failure');
        Object.assign(data, clone(updates)); calls.writes++;
      },
      remove: async key => { delete data[key]; },
    } },
    cookies: {
      getAll: async () => clone(jar),
      get: async ({ name }) => clone(jar.find(c => c.name === name && !c.partitionKey)),
      remove: async details => {
        calls.remove.push(details);
        if (failRemove?.(details)) throw new Error('cookie removal failed');
        const host = new URL(details.url).hostname;
        const path = new URL(details.url).pathname;
        const index = jar.findIndex(c => c.name === details.name && c.path === path &&
          (c.domain.replace(/^\./, '') === host || (!c.hostOnly && host.endsWith(c.domain))) &&
          JSON.stringify(c.partitionKey) === JSON.stringify(details.partitionKey));
        if (index < 0) return null;
        const [removed] = jar.splice(index, 1);
        cookieListener?.({ cookie: clone(removed), removed: true, cause: 'explicit' });
        return details;
      },
      set: async details => {
        calls.set.push(clone(details));
        if (failSet?.(details)) return null;
        const host = new URL(details.url).hostname;
        const next = cookie(details.name, details.value, {
          ...details, domain: details.domain ? `.${details.domain}` : host,
          hostOnly: !details.domain, session: !details.expirationDate,
        });
        jar = jar.filter(c => !(c.name === next.name && c.domain === next.domain && c.path === next.path &&
          JSON.stringify(c.partitionKey) === JSON.stringify(next.partitionKey)));
        jar.push(next);
        cookieListener?.({ cookie: clone(next), removed: false, cause: 'explicit' });
        return clone(next);
      },
      onChanged: { addListener: handler => { cookieListener = handler; } },
    },
    tabs: {
      query: async () => [{ id: 1 }, { id: 2 }],
      reload: async id => { calls.reload.push(id); if (tabFailure) throw new Error('closed tab'); },
      create: async details => { calls.create.push(details); return { id: 3 }; },
    },
    runtime: {
      id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: handler => { listener = handler; } },
      onStartup: { addListener: () => {} },
    },
  };
  vm.runInNewContext(source, { chrome, crypto: webcrypto, URL, console, Date, Set, Promise });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/popup.html') };
  return {
    data, calls, chrome, popup,
    jar: () => clone(jar),
    setJar: (value, emit = false) => {
      jar = clone(value);
      if (emit) cookieListener({ cookie: jar[0], removed: false, cause: 'explicit' });
    },
    message: (type, payload = {}, sender = popup) => new Promise(resolve => listener({ type, payload }, sender, result => resolve(clone(result)))),
  };
}

test('logged-out state never reports a stale active account; no credentials are returned', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))], activeSlotId: 'a' } });
  const state = await h.message('GET_STATE');
  assert.equal(state.activeSlotId, null);
  assert.equal(state.currentSession, null);
  assert.equal(state.slots[0].status, 'saved');
  assert.equal(JSON.stringify(state).includes('auth-token'), false);
  assert.deepEqual(h.calls.access, [{ accessLevel: 'TRUSTED_CONTEXTS' }]);
});

test('saving requires an authenticated session; expired and partitioned tokens do not qualify', async () => {
  for (const cookies of [[], [cookie('auth-token', 'expired', { expirationDate: 1 })],
    [cookie('auth-token', 'partitioned', { partitionKey: { topLevelSite: 'https://example.com' } })]]) {
    const h = harness({ cookies });
    assert.equal((await h.message('SAVE_CURRENT')).error, 'NOT_LOGGED_IN');
    assert.equal(h.data.slots, undefined);
  }
});

test('save detects identity, avoids duplicate accounts, and retains legacy labels', async () => {
  const h = harness({ cookies: session('alice') });
  const first = await h.message('SAVE_CURRENT');
  assert.equal(first.slot.label, 'alice');
  await h.message('SAVE_CURRENT');
  assert.equal(h.data.slots.length, 1);
  const old = harness({ storage: { slots: [slot('legacy', session('alice'), { label: 'Streaming' })] }, cookies: session('alice', 'new-token') });
  await old.message('SAVE_CURRENT');
  assert.equal(old.data.slots.length, 1);
  assert.equal(old.data.slots[0].label, 'Streaming');
  assert.equal(old.data.slots[0].cookies[0].value, 'new-token');
});

test('wrong account cannot overwrite a saved session', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))] }, cookies: session('bob') });
  assert.equal((await h.message('SAVE_SLOT', { slotId: 'a' })).error, 'ACCOUNT_MISMATCH');
  assert.equal(h.data.slots[0].cookies[0].value, 'alice');
});

test('expiry is checked before touching current cookies', async () => {
  const expired = session('bob').map(c => ({ ...c, expirationDate: 1 }));
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', expired)] }, cookies: session('alice') });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'SESSION_EXPIRED');
  assert.equal(h.calls.remove.length, 0);
  assert.equal(h.jar()[0].value, 'alice');
});

test('switch snapshots outgoing cookies and preserves host-only, store and partition metadata', async () => {
  const partition = cookie('embed-pref', 'bob-pref', { domain: 'www.twitch.tv', hostOnly: true,
    partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true }, session: true, expirationDate: undefined });
  const a = session('alice');
  const h = harness({ storage: { slots: [slot('a', a), slot('b', [...session('bob'), partition])], activeSlotId: 'a' },
    cookies: [...a, cookie('preference', 'latest')] });
  const response = await h.message('SWITCH_TO_SLOT', { slotId: 'b' });
  assert.equal(response.ok, true);
  assert.equal(h.data.slots[0].cookies.at(-1).value, 'latest');
  assert.equal(h.jar()[0].value, 'bob');
  const restored = h.calls.set.find(c => c.name === 'embed-pref');
  assert.equal(restored.domain, undefined);
  assert.equal(restored.expirationDate, undefined);
  assert.equal(restored.storeId, '0');
  assert.deepEqual(restored.partitionKey, partition.partitionKey);
  assert.deepEqual(h.calls.reload, [1, 2]);
  assert.equal(h.data.cookieTransaction, undefined);
});

test('failed cookie restoration rolls back the browser and active account', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', session('bob'))], activeSlotId: 'a' },
    cookies: session('alice'), failSet: details => details.value === 'bob' });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'SWITCH_FAILED');
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.data.activeSlotId, 'a');
  assert.equal(h.data.cookieTransaction, undefined);
});

test('storage failure after cookie restoration rolls back before reporting success', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', session('bob'))], activeSlotId: 'a' },
    cookies: session('alice'), failStorage: updates => updates.activeSlotId === 'b' });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'SWITCH_FAILED');
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.data.activeSlotId, 'a');
  assert.equal(h.data.cookieTransaction, undefined);
});

test('cookie clearing failure never starts the target restore and keeps the original session', async () => {
  let failOnce = true;
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', session('bob'))], activeSlotId: 'a' },
    cookies: session('alice'), failRemove: () => { const fail = failOnce; failOnce = false; return fail; } });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'SWITCH_FAILED');
  assert.equal(h.calls.set.some(c => c.value === 'bob'), false);
  assert.equal(h.jar()[0].value, 'alice');
});

test('failed rollback keeps a durable backup for the next invocation', async () => {
  let fail = true;
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', session('bob'))], activeSlotId: 'a' },
    cookies: session('alice'), failSet: () => fail });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'RECOVERY_FAILED');
  assert.equal(h.data.cookieTransaction.cookies[0].value, 'alice');
  fail = false;
  assert.equal((await h.message('GET_STATE')).activeSlotId, 'a');
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.data.cookieTransaction, undefined);
});

test('worker restart recovers an interrupted transaction before handling state', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))], cookieTransaction: {
    cookies: session('alice'), activeSlotId: 'a', pendingLogin: null,
  } }, cookies: [cookie('login', 'half-restored')] });
  assert.equal((await h.message('GET_STATE')).activeSlotId, 'a');
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.data.cookieTransaction, undefined);
});

test('tab reload failure reports a warning without undoing the successful switch', async () => {
  const h = harness({ storage: { slots: [slot('b', session('bob'))] }, tabFailure: true });
  const response = await h.message('SWITCH_TO_SLOT', { slotId: 'b' });
  assert.equal(response.ok, true);
  assert.equal(response.reloadWarning, true);
  assert.equal(h.jar()[0].value, 'bob');
});

test('connecting another account saves an unknown current session and supports cancel', async () => {
  const h = harness({ cookies: session('alice') });
  assert.equal((await h.message('BEGIN_LOGIN')).ok, true);
  assert.equal(h.data.slots[0].login, 'alice');
  assert.equal(h.jar().length, 0);
  assert.equal(h.calls.create[0].url, 'https://www.twitch.tv/login');
  assert.equal((await h.message('GET_STATE')).pendingLogin.slotId, null);
  assert.equal((await h.message('COMPLETE_LOGIN')).error, 'NOT_LOGGED_IN');
  h.setJar(session('bob'));
  assert.equal((await h.message('CANCEL_LOGIN')).ok, true);
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.data.pendingLogin, null);
});

test('login can finish after popup/worker restart and returns only safe pending metadata', async () => {
  const h = harness({ cookies: session('alice') });
  await h.message('BEGIN_LOGIN');
  const restarted = harness({ storage: h.data, cookies: session('bob') });
  const state = await restarted.message('GET_STATE');
  assert.equal(state.pendingLogin.originalCookies, undefined);
  assert.equal((await restarted.message('COMPLETE_LOGIN')).ok, true);
  assert.equal(restarted.data.slots.length, 2);
  assert.equal(restarted.data.pendingLogin, null);
});

test('reauthentication checks account identity and replaces the correct session', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))] } });
  await h.message('BEGIN_LOGIN', { slotId: 'a' });
  h.setJar(session('bob'));
  assert.equal((await h.message('COMPLETE_LOGIN')).error, 'ACCOUNT_MISMATCH');
  assert.notEqual(h.data.pendingLogin, null);
  h.setJar(session('alice', 'renewed'));
  assert.equal((await h.message('COMPLETE_LOGIN')).ok, true);
  assert.equal(h.data.slots.length, 1);
  assert.equal(h.data.slots[0].cookies[0].value, 'renewed');
});

test('expired legacy login cookies retain identity for guided reauthentication', async () => {
  const expired = session('alice').map(c => ({ ...c, expirationDate: 1 }));
  const h = harness({ storage: { slots: [slot('legacy', expired, { label: 'Streaming' })] } });
  const state = await h.message('GET_STATE');
  assert.equal(state.slots[0].status, 'expired');
  assert.equal(state.slots[0].login, 'alice');
  assert.equal((await h.message('BEGIN_LOGIN', { slotId: 'legacy' })).ok, true);
  h.setJar(session('alice', 'renewed'));
  assert.equal((await h.message('COMPLETE_LOGIN')).ok, true);
  assert.equal(h.data.slots[0].id, 'legacy');
  assert.equal(h.data.slots[0].label, 'Streaming');
});

test('unsaved sessions cannot be silently discarded by a switch', async () => {
  const h = harness({ storage: { slots: [slot('b', session('bob'))] }, cookies: session('alice') });
  assert.equal((await h.message('SWITCH_TO_SLOT', { slotId: 'b' })).error, 'UNSAVED_SESSION');
  assert.equal(h.calls.remove.length, 0);
});

test('overlapping mutations serialize and do not lose slots or session snapshots', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice')), slot('b', session('bob'))] }, cookies: session('alice') });
  const responses = await Promise.all([
    h.message('RENAME_SLOT', { slotId: 'a', label: 'Main' }),
    h.message('SWITCH_TO_SLOT', { slotId: 'b' }),
    h.message('RENAME_SLOT', { slotId: 'b', label: 'Alt' }),
  ]);
  assert.ok(responses.every(r => r.ok));
  assert.deepEqual(h.data.slots.map(s => s.label), ['Main', 'Alt']);
  assert.equal(h.data.activeSlotId, 'b');
});

test('repeat state reads do not write storage indefinitely', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'), { login: 'alice' })], activeSlotId: 'a' }, cookies: session('alice') });
  await h.message('GET_STATE');
  const writes = h.calls.writes;
  for (let i = 0; i < 5; i++) await h.message('GET_STATE');
  assert.equal(h.calls.writes, writes);
});

test('cookie changes refresh known sessions but never replace them with unknown tokens', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))], activeSlotId: 'a' }, cookies: session('alice') });
  h.setJar([...session('alice'), cookie('preference', 'updated')], true);
  await h.message('GET_STATE');
  assert.equal(h.data.slots[0].cookies.at(-1).value, 'updated');
  h.setJar(session('bob'), true);
  await h.message('GET_STATE');
  assert.equal(h.data.slots[0].cookies[0].value, 'alice');
});

test('sender restrictions keep account management in the popup', async () => {
  const h = harness();
  const sender = { id: h.chrome.runtime.id, url: 'https://www.twitch.tv/channel', tab: { id: 1 }, frameId: 0 };
  assert.equal((await h.message('GET_STATE', {}, sender)).ok, true);
  assert.equal((await h.message('SAVE_CURRENT', {}, sender)).error, 'FORBIDDEN');
  assert.equal((await h.message('GET_STATE', {}, { ...sender, frameId: 1 })).error, 'FORBIDDEN');
  assert.equal((await h.message('GET_STATE', {}, { ...sender, tab: { incognito: true } })).error, 'FORBIDDEN');
  assert.equal((await h.message('GET_STATE', {}, { ...sender, url: 'https://www.twitch.tv.evil.com/' })).error, 'FORBIDDEN');
});

test('removing a saved account does not touch browser cookies', async () => {
  const h = harness({ storage: { slots: [slot('a', session('alice'))], activeSlotId: 'a' }, cookies: session('alice') });
  await h.message('DELETE_SLOT', { slotId: 'a' });
  assert.equal(h.data.slots.length, 0);
  assert.equal(h.jar()[0].value, 'alice');
  assert.equal(h.calls.remove.length, 0);
});
