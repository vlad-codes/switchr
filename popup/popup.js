
const mainContent    = document.getElementById('mainContent');
const indicatorDots  = document.getElementById('indicatorDots');
const footerCount    = document.getElementById('footerCount');
const toastEl        = document.getElementById('toast');
const themeToggleBtn = document.getElementById('themeToggle');

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  themeToggleBtn.textContent = theme === 'dark' ? '☀' : '☾';
  localStorage.setItem('switchr-theme', theme);
}

(function initTheme() {
  const saved = localStorage.getItem('switchr-theme');
  const prefersDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
})();

themeToggleBtn.addEventListener('click', () => {
  applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
});

let toastTimer = null;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden', 'error');
  if (isError) toastEl.classList.add('error');
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2500);
}

function errorMessage(code) {
  switch (code) {
    case 'SLOT_EMPTY':       return 'Keine gespeicherte Session. Erst speichern!';
    case 'SLOT_NOT_FOUND':   return 'Slot nicht gefunden.';
    case 'SESSION_EXPIRED':  return 'Session abgelaufen — neu einloggen & speichern.';
    default:                 return 'Unbekannter Fehler.';
  }
}

// ── Monogram ─────────────────────────────────────────────────────────────────
function makeMonogram(label, sizeClass) {
  const el = document.createElement('div');
  el.className = `monogram ${sizeClass}`;
  el.textContent = label.slice(0, 2).toUpperCase();
  return el;
}

// ── Indicator dots ────────────────────────────────────────────────────────────
function renderDots(slots, activeSlotId) {
  indicatorDots.innerHTML = '';
  slots.forEach(slot => {
    const dot = document.createElement('div');
    dot.className = 'indicator-dot' + (slot.id === activeSlotId ? ' active' : '');
    dot.title = slot.label;
    dot.addEventListener('click', async () => {
      if (slot.id === activeSlotId) return;
      await handleSwitch(slot.id, null);
    });
    indicatorDots.appendChild(dot);
  });
}

// ── Hero card ─────────────────────────────────────────────────────────────────
function renderHeroCard(slot) {
  const card = document.createElement('div');
  card.className = 'hero-card';

  // Top row
  const top = document.createElement('div');
  top.className = 'hero-top';

  const mono = makeMonogram(slot.label, 'monogram-lg');

  const nameRow = document.createElement('div');
  nameRow.className = 'hero-name-row';

  const nameInput = document.createElement('input');
  nameInput.className = 'hero-name-input';
  nameInput.type = 'text';
  nameInput.value = slot.label;
  nameInput.maxLength = 30;
  nameInput.addEventListener('blur', async () => {
    const newLabel = nameInput.value.trim() || slot.label;
    nameInput.value = newLabel;
    if (newLabel !== slot.label) {
      await send('RENAME_SLOT', { slotId: slot.id, label: newLabel });
      slot.label = newLabel;
    }
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') { nameInput.value = slot.label; nameInput.blur(); }
  });

  const statusRow = document.createElement('div');
  statusRow.className = 'status-row';

  const statusDot = document.createElement('div');
  statusDot.className = 'status-dot' + (slot.savedAt ? '' : ' inactive');

  const statusLabel = document.createElement('span');
  statusLabel.className = 'status-label' + (slot.savedAt ? '' : ' unsaved');
  statusLabel.textContent = slot.savedAt ? 'active session' : 'not saved';

  statusRow.append(statusDot, statusLabel);
  nameRow.append(nameInput, statusRow);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'hero-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Slot löschen';
  closeBtn.addEventListener('click', () => handleDeleteRequest(slot, card));

  top.append(mono, nameRow, closeBtn);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'hero-actions';

  const updateBtn = document.createElement('button');
  updateBtn.className = 'btn-hero-primary';
  updateBtn.textContent = 'update token';
  updateBtn.addEventListener('click', () => handleHeroSave(slot.id, updateBtn, nameInput));

  actions.append(updateBtn);
  card.append(top, actions);
  return card;
}

// ── Inactive account row ──────────────────────────────────────────────────────
function renderAccountRow(slot, delay) {
  const row = document.createElement('div');
  row.className = 'account-row';
  row.style.animationDelay = `${delay * 0.04}s`;

  const mono = makeMonogram(slot.label, 'monogram-sm');

  const nameEl = document.createElement('span');
  nameEl.className = 'account-name';
  nameEl.textContent = slot.label;
  nameEl.title = 'Doppelklick zum Umbenennen';
  nameEl.addEventListener('dblclick', () => startRowRename(nameEl, slot));

  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const switchBtn = document.createElement('button');
  switchBtn.className = 'btn-switch';
  switchBtn.textContent = 'switch';
  if (!slot.savedAt) {
    switchBtn.disabled = true;
    switchBtn.title = 'Noch keine Session gespeichert';
  }
  switchBtn.addEventListener('click', () => handleSwitch(slot.id, switchBtn));

  actions.appendChild(switchBtn);

  if (!slot.savedAt) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-save';
    saveBtn.textContent = 'save';
    saveBtn.addEventListener('click', () => handleSaveInactive(slot.id, saveBtn));
    actions.appendChild(saveBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-row-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => handleDeleteRequest(slot, row));
  actions.appendChild(closeBtn);

  row.append(mono, nameEl, actions);
  return row;
}

// ── Add row / form ────────────────────────────────────────────────────────────
function renderAddRow() {
  const row = document.createElement('div');
  row.className = 'add-row';

  const icon = document.createElement('div');
  icon.className = 'add-icon';
  icon.textContent = '+';

  const label = document.createElement('span');
  label.className = 'add-label';
  label.textContent = 'add account';

  row.append(icon, label);
  row.addEventListener('click', () => row.replaceWith(renderAddForm()));
  return row;
}

function renderAddForm() {
  const form = document.createElement('div');
  form.className = 'add-form';

  const input = document.createElement('input');
  input.className = 'add-input';
  input.type = 'text';
  input.placeholder = 'Account-Name...';
  input.maxLength = 30;

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-add-confirm';
  confirmBtn.textContent = '✓';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-add-cancel';
  cancelBtn.textContent = '✕';

  async function commit() {
    const res = await send('ADD_SLOT', { label: input.value.trim() || undefined });
    if (res?.ok) {
      await render();
    } else {
      showToast(errorMessage(res?.error), true);
      form.replaceWith(renderAddRow());
    }
  }

  confirmBtn.addEventListener('click', commit);
  cancelBtn.addEventListener('click', () => form.replaceWith(renderAddRow()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') form.replaceWith(renderAddRow());
  });

  form.append(input, confirmBtn, cancelBtn);
  setTimeout(() => input.focus(), 0);
  return form;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function renderOnboarding() {
  const el = document.createElement('div');
  el.className = 'onboarding';
  el.innerHTML = `
    <p class="onboarding-title">SO FUNKTIONIERT'S</p>
    <ol class="onboarding-steps">
      <li>Auf Twitch mit Account A einloggen</li>
      <li>Slot hinzufügen &amp; <strong>update token</strong> klicken</li>
      <li>Auf Twitch mit Account B einloggen</li>
      <li>Zweiten Slot hinzufügen &amp; speichern</li>
      <li>Jetzt kannst du per <strong>switch</strong> wechseln</li>
    </ol>`;
  return el;
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function handleDeleteRequest(slot, el) {
  if (el.nextSibling?.classList?.contains('delete-confirm-row')) return;

  const confirm = document.createElement('div');
  confirm.className = 'delete-confirm-row';

  const msg = document.createElement('span');
  msg.textContent = `"${slot.label}" löschen?`;

  const yesBtn = document.createElement('button');
  yesBtn.className = 'btn-confirm-delete';
  yesBtn.textContent = 'Löschen';

  const noBtn = document.createElement('button');
  noBtn.className = 'btn-cancel-delete';
  noBtn.textContent = 'Abbrechen';

  yesBtn.addEventListener('click', async () => {
    confirm.remove();
    await send('DELETE_SLOT', { slotId: slot.id });
    await render();
  });
  noBtn.addEventListener('click', () => confirm.remove());

  confirm.append(msg, yesBtn, noBtn);
  el.insertAdjacentElement('afterend', confirm);
}

// ── Rename ────────────────────────────────────────────────────────────────────

function startRowRename(nameEl, slot) {
  const input = document.createElement('input');
  input.className = 'add-input';
  input.style.fontSize = '11px';
  input.value = slot.label;
  input.maxLength = 30;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newLabel = input.value.trim() || slot.label;
    await send('RENAME_SLOT', { slotId: slot.id, label: newLabel });
    slot.label = newLabel;
    const newEl = document.createElement('span');
    newEl.className = 'account-name';
    newEl.textContent = newLabel;
    newEl.title = 'Doppelklick zum Umbenennen';
    newEl.addEventListener('dblclick', () => startRowRename(newEl, slot));
    input.replaceWith(newEl);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = slot.label; input.blur(); }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function handleHeroSave(slotId, btn, nameInput) {
  btn.disabled = true;
  btn.textContent = '...';
  const res = await send('SAVE_SLOT', { slotId });
  btn.disabled = false;
  btn.textContent = 'update token';
  if (res?.ok) {
    const tick = document.createElement('span');
    tick.className = 'saved-confirm';
    tick.textContent = '✓ saved';
    nameInput.insertAdjacentElement('afterend', tick);
    setTimeout(() => tick.remove(), 1500);
  } else {
    showToast(errorMessage(res?.error), true);
  }
}


async function handleSwitch(slotId, btn) {
  if (btn) { btn.classList.add('loading'); btn.textContent = ''; }
  const res = await send('SWITCH_TO_SLOT', { slotId });
  if (btn) { btn.classList.remove('loading'); btn.textContent = 'switch'; }
  if (res?.ok) {
    showToast(res.noTabs ? 'Gewechselt — öffne twitch.tv' : 'Account gewechselt ✓');
    await render();
  } else {
    showToast(errorMessage(res?.error), true);
  }
}

async function handleSaveInactive(slotId, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const res = await send('SAVE_SLOT', { slotId });
  if (res?.ok) {
    showToast('Session gespeichert ✓');
    await render();
  } else {
    btn.disabled = false;
    btn.textContent = 'save';
    showToast(errorMessage(res?.error), true);
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  const { slots, activeSlotId } = await send('GET_STATE');

  mainContent.innerHTML = '';
  renderDots(slots, activeSlotId);
  footerCount.textContent = `${slots.length} account${slots.length !== 1 ? 's' : ''}`;

  if (slots.length === 0) {
    mainContent.appendChild(renderOnboarding());
    mainContent.appendChild(renderAddRow());
    return;
  }

  const activeSlot   = slots.find(s => s.id === activeSlotId) ?? slots[0];
  const inactiveSlots = slots.filter(s => s.id !== activeSlot.id);

  mainContent.appendChild(renderHeroCard(activeSlot));

  if (inactiveSlots.length > 0) {
    const section = document.createElement('div');
    section.className = 'accounts-section';
    inactiveSlots.forEach((slot, i) => section.appendChild(renderAccountRow(slot, i)));
    mainContent.appendChild(section);
  }

  mainContent.appendChild(renderAddRow());
}

render();
