'use strict';

const main = document.getElementById('mainContent');
const toast = document.getElementById('toast');
const themeToggle = document.getElementById('themeToggle');
let state = null;
let busy = false;
let editing = false;
let expandedSlotId = null;
let toastTimer;
let renderVersion = 0;

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('switchr-theme', theme);
  themeToggle.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`);
}
applyTheme(localStorage.getItem('switchr-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
themeToggle.addEventListener('click', () => applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));

const errors = {
  SLOT_EMPTY: 'This account has no saved session. Choose Sign in again.',
  SLOT_NOT_FOUND: 'This account was removed. Refresh and try again.',
  SESSION_EXPIRED: 'The saved cookie expired. Choose Sign in again for this account.',
  NOT_LOGGED_IN: 'Finish signing in on Twitch, then save your session here.',
  ACCOUNT_MISMATCH: 'You signed in to a different account. Sign in to the account shown above, then try again.',
  ACCOUNT_ALREADY_SAVED: 'This session belongs to another saved account.',
  IDENTITY_UNKNOWN: 'This old session has no account identity. Save your current login as an account, then remove the old entry.',
  LOGIN_IN_PROGRESS: 'Finish or cancel the login in progress first.',
  NO_LOGIN_IN_PROGRESS: 'This login was already finished or cancelled. Refresh to continue.',
  UNSAVED_SESSION: 'Save your current session first so you can return to it.',
  SWITCH_FAILED: 'The switch failed. Your previous cookies were restored. Try again.',
  RECOVERY_FAILED: 'Your previous session could not be restored. Its backup is still stored. Refresh to retry recovery.',
  INVALID_LABEL: 'Enter a name for this account.',
};
function errorMessage(code) { return errors[code] || 'Could not complete that action. Reload the extension and try again.'; }
async function send(type, payload = {}) {
  const response = await (globalThis.browser || chrome).runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error || 'OPERATION_FAILED');
  return response;
}
function notice(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast${error ? ' error' : ''}`;
  toast.setAttribute('role', error ? 'alert' : 'status');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), error ? 9000 : 4000);
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function button(text, className, action) {
  const btn = element('button', className, text);
  btn.type = 'button';
  btn.addEventListener('click', action);
  return btn;
}
async function action(type, payload, message, trigger) {
  if (busy) return;
  busy = true;
  main.setAttribute('aria-busy', 'true');
  main.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
  if (trigger) {
    trigger.textContent = 'Switching…';
    trigger.classList.add('switching');
  }
  try {
    const response = await send(type, payload);
    if (response.reloadWarning) notice('Session updated. Open or reload Twitch to continue.', true);
    else if (response.noTabs) notice('Switched. Open Twitch to use this account.');
    else if (message) notice(message);
  } catch (error) { notice(errorMessage(error.message), true); }
  finally {
    busy = false;
    editing = false;
    expandedSlotId = null;
    await refresh();
  }
}
function avatar(label) {
  const el = element('div', 'avatar', label.slice(0, 2).toUpperCase());
  el.setAttribute('aria-hidden', 'true');
  return el;
}
function sectionLabel(text) { return element('h2', 'section-label', text); }
function editAccount(slot, row) {
  if (busy || editing) return;
  editing = true;
  const form = element('form', 'edit-form');
  const input = element('input');
  input.value = slot.label;
  input.maxLength = 40;
  input.required = true;
  input.setAttribute('aria-label', 'Account name');
  const save = button('Save name', 'primary small', () => form.requestSubmit());
  const cancel = button('Cancel', 'secondary small', () => { editing = false; render(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    action('RENAME_SLOT', { slotId: slot.id, label: input.value }, 'Account renamed.');
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { editing = false; render(); } });
  form.append(input, save, cancel);
  row.append(form);
  input.focus();
  input.select();
}
function removeAccount(slot, row) {
  if (busy || editing) return;
  editing = true;
  const confirm = element('div', 'confirmation');
  confirm.append(element('p', '', `Remove ${slot.label} from Switchr? This only removes the saved copy; it does not log you out of Twitch.`));
  const controls = element('div', 'controls');
  controls.append(
    button('Remove account', 'danger small', () => action('DELETE_SLOT', { slotId: slot.id }, 'Saved account removed.')),
    button('Keep account', 'secondary small', () => { editing = false; render(); }),
  );
  confirm.append(controls);
  row.append(confirm);
  controls.lastChild.focus();
}
function accountCard(slot) {
  const active = slot.status === 'active';
  const card = element('article', `account-card${active ? ' current-account' : ''}`);
  if (active) card.append(element('span', 'eyebrow current-label', 'CURRENT ACCOUNT'));
  const top = element('div', 'account-top');
  const details = element('div', 'account-details');
  const name = element(active ? 'h1' : 'h3', 'account-name', slot.label);
  name.title = slot.label;
  details.append(name);
  if (slot.login && slot.label !== slot.login) details.append(element('p', 'account-login', `@${slot.login}`));
  if (['expired', 'empty'].includes(slot.status)) details.append(element('p', 'account-status', slot.status === 'expired' ? 'Sign in needed' : 'Not connected'));
  top.append(avatar(slot.label), details);
  const controls = element('div', 'controls');
  if (!active) {
    const connect = ['expired', 'empty'].includes(slot.status);
    const switchBtn = button(connect ? 'Sign in' : 'Switch', connect ? 'secondary small' : 'primary small switch-button',
      () => action(connect ? 'BEGIN_LOGIN' : 'SWITCH_TO_SLOT', { slotId: slot.id }, connect ? 'Sign in on Twitch, then return here.' : `Switched to ${slot.label}.`, connect ? null : switchBtn));
    switchBtn.disabled = !!state.pendingLogin || (!connect && !!state.currentSession && !state.currentSession.saved);
    if (switchBtn.disabled && !state.pendingLogin) switchBtn.title = 'Save your current account before switching.';
    switchBtn.setAttribute('aria-label', `${connect ? 'Sign in to' : 'Switch to'} ${slot.label}`);
    controls.append(switchBtn);
  }
  const manage = button('⋯', 'icon-button manage-button', () => {
    if (editing) return;
    expandedSlotId = expandedSlotId === slot.id ? null : slot.id;
    render();
  });
  manage.title = `Manage ${slot.label}`;
  manage.setAttribute('aria-label', `Manage ${slot.label}`);
  manage.setAttribute('aria-expanded', String(expandedSlotId === slot.id));
  manage.setAttribute('aria-controls', `manage-${slot.id}`);
  controls.append(manage);
  top.append(controls);
  const panel = element('div', 'manage-actions');
  panel.id = `manage-${slot.id}`;
  panel.hidden = expandedSlotId !== slot.id;
  panel.append(
    button('Rename', 'secondary small', () => editAccount(slot, card)),
    button('Sign in again', 'secondary small', () => action('BEGIN_LOGIN', { slotId: slot.id }, 'Sign in on Twitch, then return here.')),
    button('Remove', 'text-button remove', () => removeAccount(slot, card)),
  );
  if (state.pendingLogin) panel.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
  card.append(top, panel);
  return card;
}
function renderPending() {
  const panel = element('section', 'session-panel pending');
  const pending = state.pendingLogin;
  panel.append(element('span', 'eyebrow', 'CONNECT ACCOUNT'));
  const expectedLogin = state.slots.find(slot => slot.id === pending.slotId)?.login;
  panel.append(element('h1', '', pending.label ? `Sign in to ${pending.label}` : state.slots.length ? 'Sign in to your next account.' : 'Sign in to Twitch.'));
  panel.append(element('p', 'description', `${expectedLogin ? `Use @${expectedLogin} in the Twitch tab` : 'Sign in in the Twitch tab'}, including any security checks. Then return here to save the session.`));
  const current = state.currentSession;
  const mismatch = current && expectedLogin && current.login !== expectedLogin;
  panel.append(element('p', `login-state${current && !mismatch ? ' ready' : ''}`, mismatch ? `This session is ${current.login ? `@${current.login}` : 'unidentified'}. Sign in as @${expectedLogin}.` : current ? `Session found${current.login ? ` · @${current.login}` : ''}` : 'Waiting for you to sign in…'));
  const controls = element('div', 'controls');
  const save = button('Save signed-in account', 'primary', () => action('COMPLETE_LOGIN', {}, 'Account connected.'));
  save.disabled = !current || !!mismatch;
  controls.append(save, button('Cancel', 'secondary', () => action('CANCEL_LOGIN', {}, 'Returned to your previous session.')));
  panel.append(controls, element('p', 'hint', 'Cancel restores your previous browser session.'));
  return panel;
}
function renderSession() {
  const current = state.currentSession;
  const panel = element('section', 'session-panel');
  panel.append(element('span', 'eyebrow', 'BROWSER SESSION'));
  if (!current) {
    panel.append(element('h1', '', state.slots.length ? 'You’re signed out.' : 'Connect your Twitch accounts.'));
    panel.append(element('p', 'description', state.slots.length ? 'Choose an account below to continue.' : 'Connect each account once, then switch here.'));
    if (!state.slots.length) panel.append(button('Connect your first account →', 'primary', () => action('BEGIN_LOGIN', {}, 'Sign in on Twitch, then return here.')));
  } else if (!current.saved) {
    panel.append(element('h1', '', current.login ? `Save @${current.login}` : 'Save your Twitch account.'));
    panel.append(element('p', 'description', 'Save this login before switching accounts.'));
    panel.append(button('Save current account', 'primary', () => action('SAVE_CURRENT', {}, 'Current session saved.')));
  } else {
    const slot = state.slots.find(s => s.id === state.activeSlotId);
    return accountCard(slot);
  }
  return panel;
}
function render() {
  if (!state) return;
  const focused = document.activeElement?.getAttribute('aria-label');
  main.replaceChildren(state.pendingLogin ? renderPending() : renderSession());
  const otherAccounts = state.slots.filter(slot => slot.id !== state.activeSlotId);
  if (!state.pendingLogin && otherAccounts.length) {
    main.append(sectionLabel(state.currentSession?.saved ? 'SWITCH ACCOUNT' : 'YOUR ACCOUNTS'));
    const list = element('div', 'accounts');
    otherAccounts.forEach(slot => list.append(accountCard(slot)));
    main.append(list);
  }
  if (!state.pendingLogin && (state.slots.length || state.currentSession)) {
    main.append(button('+ Connect another account', 'add-account', () => action('BEGIN_LOGIN', {}, 'Sign in on Twitch, then return here.')));
    main.lastChild.title = 'Saves your current account, then opens Twitch sign-in.';
  }
  if (state.slots.length && !state.pendingLogin) main.append(element('p', 'scope-note', 'Switching updates all Twitch tabs.'));
  document.getElementById('accountCount').textContent = state.slots.length ? `${state.slots.length} account${state.slots.length === 1 ? '' : 's'}` : 'Twitch';
  main.setAttribute('aria-busy', 'false');
  if (focused) [...main.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === focused)?.focus();
}
async function refresh() {
  const version = ++renderVersion;
  try {
    const next = await send('GET_STATE');
    if (version !== renderVersion) return;
    state = next;
    if (!busy && !editing) render();
  } catch (error) {
    if (version !== renderVersion) return;
    main.replaceChildren(element('p', 'load-error', errorMessage(error.message)), button('Try again', 'secondary retry', refresh));
    main.setAttribute('aria-busy', 'false');
  }
}
document.getElementById('openTwitch').addEventListener('click', () => action('OPEN_TWITCH', {}, 'Twitch opened.'));
chrome.storage?.onChanged.addListener((_changes, area) => { if (area === 'local' && !busy && !editing) refresh(); });
window.addEventListener('focus', () => { if (!busy && !editing) refresh(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || editing || !expandedSlotId) return;
  event.preventDefault();
  const panelId = `manage-${expandedSlotId}`;
  expandedSlotId = null;
  render();
  [...main.querySelectorAll('.manage-button')].find(btn => btn.getAttribute('aria-controls') === panelId)?.focus();
});
// Login happens in another tab; poll while this popup remains open.
setInterval(() => { if (state?.pendingLogin && !busy && !editing) refresh(); }, 2000);
refresh();
