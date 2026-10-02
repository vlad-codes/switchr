'use strict';

const TWITCH_URL = 'https://www.twitch.tv/';
const TAB_URLS = ['*://*.twitch.tv/*', '*://twitch.tv/*'];
const STORAGE_KEYS = ['slots', 'activeSlotId', 'pendingLogin', 'cookieTransaction'];

// Session credentials are only available to the worker and extension pages.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(() => ready).then(task);
  queue = result.catch(() => {});
  return result;
}
function fail(code) { throw new Error(code); }
async function getStorage() {
  const data = await chrome.storage.local.get(STORAGE_KEYS);
  return { slots: [], activeSlotId: null, pendingLogin: null, ...data };
}
function cookieURL(cookie) {
  return `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
}
function cookieToSetDetails(cookie) {
  const details = {
    url: cookieURL(cookie), name: cookie.name, value: cookie.value,
    path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
  };
  if (!cookie.hostOnly && cookie.domain.startsWith('.')) details.domain = cookie.domain.replace(/^\./, '');
  if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  return details;
}
function isLive(cookie) {
  return cookie.session || !cookie.expirationDate || cookie.expirationDate > Date.now() / 1000;
}
function siteCookie(cookies, name, includeExpired = false) {
  // Only first-party cookies that actually apply to the Twitch homepage.
  return cookies.find(c => c.name === name && !c.partitionKey && c.path === '/' &&
    ['twitch.tv', '.twitch.tv', 'www.twitch.tv', '.www.twitch.tv'].includes(c.domain) && (includeExpired || isLive(c)));
}
function authCookie(cookies = []) { return siteCookie(cookies, 'auth-token'); }
function loginName(cookies = []) {
  // The account name in an expired legacy snapshot still identifies its owner.
  const value = siteCookie(cookies, 'login', true)?.value;
  return value && /^[a-zA-Z0-9_]{1,25}$/.test(value) ? value.toLowerCase() : null;
}
async function getCookies() {
  // Regular profile only; incognito access is disabled in the manifest.
  return chrome.cookies.getAll({ domain: 'twitch.tv', partitionKey: {} });
}
function matchedSlot(slots, cookies) {
  const token = authCookie(cookies)?.value;
  return token ? slots.find(slot => authCookie(slot.cookies)?.value === token) : null;
}
function snapshot(slot, cookies) {
  slot.cookies = cookies;
  slot.savedAt = Date.now();
  slot.login = slot.login || loginName(cookies);
}
async function snapshotCurrent(state, cookies) {
  const slot = matchedSlot(state.slots, cookies);
  if (slot) {
    if (JSON.stringify(slot.cookies) !== JSON.stringify(cookies) || (!slot.login && loginName(cookies))) {
      snapshot(slot, cookies);
      await chrome.storage.local.set({ slots: state.slots, activeSlotId: slot.id });
    } else if (state.activeSlotId !== slot.id) {
      await chrome.storage.local.set({ activeSlotId: slot.id });
    }
  }
  return slot;
}
async function clearCookies() {
  // Sequential removal avoids same-name host/domain cookies racing each other.
  for (const cookie of await getCookies()) {
    const details = { url: cookieURL(cookie), name: cookie.name };
    if (cookie.storeId) details.storeId = cookie.storeId;
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    await chrome.cookies.remove(details);
  }
  if ((await getCookies()).length) fail('COOKIE_CLEAR_FAILED');
}
async function restoreCookies(cookies) {
  for (const cookie of cookies.filter(isLive)) {
    const restored = await chrome.cookies.set(cookieToSetDetails(cookie));
    if (!restored) fail('COOKIE_RESTORE_FAILED');
  }
}
async function verifyAuth(cookies) {
  const expected = authCookie(cookies)?.value;
  const actual = await chrome.cookies.get({ url: TWITCH_URL, name: 'auth-token' });
  if ((actual?.value || null) !== (expected || null)) fail('COOKIE_RESTORE_FAILED');
}
async function reloadTabs({ open = false, login = false } = {}) {
  let tabs = [];
  let warning = false;
  try { tabs = await chrome.tabs.query({ url: TAB_URLS }); }
  catch { warning = true; }
  const results = await Promise.allSettled(tabs.map(tab => chrome.tabs.reload(tab.id)));
  warning ||= results.some(result => result.status === 'rejected');
  if (open) {
    try { await chrome.tabs.create({ url: login ? `${TWITCH_URL}login` : TWITCH_URL }); }
    catch { warning = true; }
  }
  return { noTabs: tabs.length === 0 && !open, reloadWarning: warning };
}
// A durable journal lets the next worker invocation undo an interrupted swap.
async function recoverTransaction() {
  const { cookieTransaction: transaction } = await getStorage();
  if (!transaction) return;
  try {
    await clearCookies();
    await restoreCookies(transaction.cookies);
    await verifyAuth(transaction.cookies);
    await chrome.storage.local.set({ activeSlotId: transaction.activeSlotId, pendingLogin: transaction.pendingLogin });
    await chrome.storage.local.remove('cookieTransaction');
    await reloadTabs();
  } catch { fail('RECOVERY_FAILED'); }
}
async function replaceCookies(cookies, updates) {
  const state = await getStorage();
  const original = await getCookies();
  await chrome.storage.local.set({ cookieTransaction: {
    cookies: original, activeSlotId: state.activeSlotId, pendingLogin: state.pendingLogin,
  } });
  try {
    await clearCookies();
    await restoreCookies(cookies);
    await verifyAuth(cookies);
    await chrome.storage.local.set(updates);
    await chrome.storage.local.remove('cookieTransaction');
  } catch {
    await recoverTransaction();
    fail('SWITCH_FAILED');
  }
}
function publicSlot(slot, activeSlotId) {
  const token = authCookie(slot.cookies);
  return {
    id: slot.id, label: slot.label, login: slot.login || loginName(slot.cookies),
    savedAt: slot.savedAt, expiresAt: token?.expirationDate ? token.expirationDate * 1000 : null,
    status: slot.id === activeSlotId ? 'active' : token ? 'saved' : slot.savedAt ? 'expired' : 'empty',
  };
}
async function getState() {
  const state = await getStorage();
  const cookies = await getCookies();
  const active = await snapshotCurrent(state, cookies);
  return {
    ok: true, slots: state.slots.map(slot => publicSlot(slot, active?.id)),
    activeSlotId: active?.id || null,
    currentSession: authCookie(cookies) ? { login: loginName(cookies), saved: !!active } : null,
    pendingLogin: state.pendingLogin ? {
      slotId: state.pendingLogin.slotId, label: state.pendingLogin.label, startedAt: state.pendingLogin.startedAt,
    } : null,
  };
}
async function saveCurrent({ slotId, label } = {}) {
  const state = await getStorage();
  if (state.pendingLogin && slotId !== state.pendingLogin.slotId) fail('LOGIN_IN_PROGRESS');
  const cookies = await getCookies();
  if (!authCookie(cookies)) fail('NOT_LOGGED_IN');
  const login = loginName(cookies);
  const existing = matchedSlot(state.slots, cookies) ||
    (login && state.slots.find(slot => (slot.login || loginName(slot.cookies)) === login));
  let slot = slotId ? state.slots.find(slot => slot.id === slotId) : existing;
  if (slotId && !slot) fail('SLOT_NOT_FOUND');
  const expectedLogin = slot && (slot.login || loginName(slot.cookies));
  if (expectedLogin && login !== expectedLogin) fail('ACCOUNT_MISMATCH');
  if (slot?.savedAt && !expectedLogin && authCookie(slot.cookies)?.value !== authCookie(cookies).value) fail('IDENTITY_UNKNOWN');
  if (existing && slot && existing.id !== slot.id) fail('ACCOUNT_ALREADY_SAVED');
  if (!slot) {
    slot = { id: crypto.randomUUID(), label: cleanLabel(label) || login || `Account ${state.slots.length + 1}` };
    state.slots.push(slot);
  }
  snapshot(slot, cookies);
  await chrome.storage.local.set({ slots: state.slots, activeSlotId: slot.id, pendingLogin: null });
  return { ok: true, slot: publicSlot(slot, slot.id) };
}
async function switchSlot({ slotId }) {
  const state = await getStorage();
  const slot = state.slots.find(item => item.id === slotId);
  if (!slot) fail('SLOT_NOT_FOUND');
  if (state.pendingLogin) fail('LOGIN_IN_PROGRESS');
  if (!authCookie(slot.cookies)) fail(slot.savedAt ? 'SESSION_EXPIRED' : 'SLOT_EMPTY');
  const cookies = await getCookies();
  const current = await snapshotCurrent(state, cookies);
  if (authCookie(cookies) && !current) fail('UNSAVED_SESSION');
  if (current?.id === slotId) return { ok: true, alreadyActive: true };
  await replaceCookies(slot.cookies, { activeSlotId: slot.id });
  return { ok: true, ...await reloadTabs() };
}
async function beginLogin({ slotId, label } = {}) {
  const state = await getStorage();
  if (state.pendingLogin) fail('LOGIN_IN_PROGRESS');
  const slot = slotId ? state.slots.find(item => item.id === slotId) : null;
  if (slotId && !slot) fail('SLOT_NOT_FOUND');
  if (slot?.savedAt && !(slot.login || loginName(slot.cookies))) fail('IDENTITY_UNKNOWN');
  const cookies = await getCookies();
  let current = await snapshotCurrent(state, cookies);
  if (authCookie(cookies) && !current) {
    // Connecting another account also keeps an as-yet unsaved current login.
    current = (await saveCurrent()).slot;
  }
  const pendingLogin = {
    slotId: slot?.id || null, label: slot?.label || cleanLabel(label) || null,
    startedAt: Date.now(), originalCookies: cookies, originalActiveSlotId: current?.id || null,
  };
  // Clear locally. Twitch's logout endpoint could revoke the saved session.
  await replaceCookies([], { activeSlotId: null, pendingLogin });
  return { ok: true, ...await reloadTabs({ open: true, login: true }) };
}
async function completeLogin() {
  const { pendingLogin } = await getStorage();
  if (!pendingLogin) fail('NO_LOGIN_IN_PROGRESS');
  return saveCurrent({ slotId: pendingLogin.slotId, label: pendingLogin.label });
}
async function cancelLogin() {
  const state = await getStorage();
  if (!state.pendingLogin) fail('NO_LOGIN_IN_PROGRESS');
  const pending = state.pendingLogin;
  await replaceCookies(pending.originalCookies, { activeSlotId: pending.originalActiveSlotId, pendingLogin: null });
  return { ok: true, ...await reloadTabs() };
}
function cleanLabel(label) { return typeof label === 'string' ? label.trim().slice(0, 40) : ''; }
async function renameSlot({ slotId, label }) {
  const state = await getStorage();
  const slot = state.slots.find(item => item.id === slotId);
  if (!slot) fail('SLOT_NOT_FOUND');
  if (!cleanLabel(label)) fail('INVALID_LABEL');
  slot.label = cleanLabel(label);
  await chrome.storage.local.set({ slots: state.slots });
  return { ok: true };
}
async function deleteSlot({ slotId }) {
  const state = await getStorage();
  if (state.pendingLogin) fail('LOGIN_IN_PROGRESS');
  if (!state.slots.some(slot => slot.id === slotId)) fail('SLOT_NOT_FOUND');
  await chrome.storage.local.set({
    slots: state.slots.filter(slot => slot.id !== slotId),
    activeSlotId: state.activeSlotId === slotId ? null : state.activeSlotId,
  });
  return { ok: true };
}
const handlers = {
  GET_STATE: getState, SAVE_CURRENT: saveCurrent, SAVE_SLOT: saveCurrent,
  SWITCH_TO_SLOT: switchSlot, BEGIN_LOGIN: beginLogin, COMPLETE_LOGIN: completeLogin,
  CANCEL_LOGIN: cancelLogin, RENAME_SLOT: renameSlot, DELETE_SLOT: deleteSlot,
  OPEN_TWITCH: async () => ({ ok: true, ...await reloadTabs({ open: true }) }),
};
const errors = new Set([
  'SLOT_NOT_FOUND', 'SLOT_EMPTY', 'SESSION_EXPIRED', 'NOT_LOGGED_IN', 'ACCOUNT_MISMATCH',
  'ACCOUNT_ALREADY_SAVED', 'IDENTITY_UNKNOWN', 'LOGIN_IN_PROGRESS', 'NO_LOGIN_IN_PROGRESS',
  'UNSAVED_SESSION', 'SWITCH_FAILED', 'RECOVERY_FAILED', 'INVALID_LABEL',
]);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromPopup = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup/popup.html');
  const fromTwitch = sender.id === chrome.runtime.id && sender.tab &&
    /^https?:\/\/(www\.)?twitch\.tv\//.test(sender.url || '') && sender.frameId === 0 && !sender.tab.incognito;
  // Twitch content scripts receive only metadata and can only request switching.
  if (!fromPopup && !(fromTwitch && ['GET_STATE', 'SWITCH_TO_SLOT'].includes(message?.type))) {
    sendResponse({ ok: false, error: 'FORBIDDEN' });
    return false;
  }
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    return false;
  }
  enqueue(async () => {
    await recoverTransaction();
    return handler(message.payload || {});
  }).then(sendResponse, error => sendResponse({ ok: false, error: errors.has(error.message) ? error.message : 'OPERATION_FAILED' }));
  return true;
});
// Keep known sessions fresh without assigning an unknown login to a saved account.
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed || cookie.partitionKey || !/(^|\.)twitch\.tv$/.test(cookie.domain) || cookie.storeId !== '0') return;
  enqueue(async () => {
    const state = await getStorage();
    if (state.cookieTransaction || state.pendingLogin) return;
    await snapshotCurrent(state, await getCookies());
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(recoverTransaction).catch(() => {});
});
