const MAX_FREE_SLOTS = 2;

const slotList = document.getElementById('slotList');
const btnAdd = document.getElementById('btnAdd');
const proHint = document.getElementById('proHint');
const footerDefault = document.getElementById('footerDefault');
const footerAdd = document.getElementById('footerAdd');
const addInput = document.getElementById('addInput');
const addConfirm = document.getElementById('addConfirm');
const addCancel = document.getElementById('addCancel');
const toastEl = document.getElementById('toast');

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

function formatDate(ts) {
  if (!ts) return 'nie gespeichert';
  const d = new Date(ts);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) +
    ', ' + d.toLocaleDateString('de-DE');
}

// --- Add-slot inline form ---

function showAddForm() {
  footerDefault.classList.add('hidden');
  footerAdd.classList.remove('hidden');
  addInput.value = '';
  addInput.focus();
}

function hideAddForm() {
  footerAdd.classList.add('hidden');
  footerDefault.classList.remove('hidden');
}

async function commitAdd() {
  const label = addInput.value.trim();
  hideAddForm();
  const res = await send('ADD_SLOT', { label: label || undefined });
  if (res?.ok) {
    await render();
  } else {
    showToast(errorMessage(res?.error), true);
  }
}

btnAdd.addEventListener('click', showAddForm);
addConfirm.addEventListener('click', commitAdd);
addCancel.addEventListener('click', hideAddForm);
addInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitAdd();
  if (e.key === 'Escape') hideAddForm();
});

// --- Slot list rendering ---

function createSlotEl(slot, isActive) {
  const li = document.createElement('li');
  li.className = 'slot-item' + (isActive ? ' active' : '');
  li.dataset.id = slot.id;

  const indicator = document.createElement('span');
  indicator.className = 'slot-indicator';
  indicator.title = isActive ? 'Aktiver Account' : 'Gespeichert: ' + formatDate(slot.savedAt);

  const label = document.createElement('span');
  label.className = 'slot-label';
  label.textContent = slot.label;
  label.title = 'Doppelklick zum Umbenennen';
  label.addEventListener('dblclick', () => startRename(li, slot));

  const actions = document.createElement('div');
  actions.className = 'slot-actions';

  const btnSwitch = document.createElement('button');
  btnSwitch.className = 'btn btn-switch';
  btnSwitch.textContent = 'Switch';
  if (!slot.savedAt) {
    btnSwitch.disabled = true;
    btnSwitch.title = 'Noch keine Session gespeichert';
  }
  btnSwitch.addEventListener('click', () => handleSwitch(slot.id, btnSwitch));

  const btnSave = document.createElement('button');
  btnSave.className = 'btn btn-save';
  btnSave.textContent = isActive ? '↺ Update' : 'Speichern';
  btnSave.title = isActive
    ? 'Aktuelle Session neu speichern'
    : 'Aktuell eingeloggten Account in diesen Slot speichern';
  btnSave.addEventListener('click', () => handleSave(slot.id, btnSave));

  const btnDel = document.createElement('button');
  btnDel.className = 'btn btn-delete';
  btnDel.textContent = '✕';
  btnDel.title = 'Slot löschen';
  btnDel.addEventListener('click', () => handleDeleteRequest(li, slot));

  actions.append(btnSwitch, btnSave, btnDel);
  li.append(indicator, label, actions);
  return li;
}

// --- Inline delete confirmation ---

function handleDeleteRequest(li, slot) {
  // Avoid stacking multiple confirms
  if (li.nextSibling?.classList?.contains('delete-confirm')) return;

  const confirm = document.createElement('li');
  confirm.className = 'delete-confirm';

  const msg = document.createElement('span');
  msg.textContent = `"${slot.label}" löschen?`;

  const yes = document.createElement('button');
  yes.className = 'btn btn-confirm-delete';
  yes.textContent = 'Löschen';

  const no = document.createElement('button');
  no.className = 'btn btn-cancel-delete';
  no.textContent = 'Abbrechen';

  yes.addEventListener('click', async () => {
    confirm.remove();
    await send('DELETE_SLOT', { slotId: slot.id });
    await render();
  });
  no.addEventListener('click', () => confirm.remove());

  confirm.append(msg, yes, no);
  li.insertAdjacentElement('afterend', confirm);
}

// --- Rename inline ---

function startRename(li, slot) {
  const labelEl = li.querySelector('.slot-label');
  const input = document.createElement('input');
  input.className = 'slot-label-input';
  input.value = slot.label;
  input.maxLength = 30;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newLabel = input.value.trim() || slot.label;
    await send('RENAME_SLOT', { slotId: slot.id, label: newLabel });
    slot.label = newLabel;
    const newLabelEl = document.createElement('span');
    newLabelEl.className = 'slot-label';
    newLabelEl.textContent = newLabel;
    newLabelEl.title = 'Doppelklick zum Umbenennen';
    newLabelEl.addEventListener('dblclick', () => startRename(li, slot));
    input.replaceWith(newLabelEl);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = slot.label; input.blur(); }
  });
}

// --- Actions ---

async function handleSwitch(slotId, btn) {
  btn.classList.add('loading');
  btn.textContent = 'Wechsle';
  const res = await send('SWITCH_TO_SLOT', { slotId });
  btn.classList.remove('loading');
  btn.textContent = 'Switch';
  if (res?.ok) {
    if (res.noTabs) {
      showToast('Gewechselt — öffne twitch.tv');
    } else {
      showToast('Account gewechselt ✓');
    }
    await render();
  } else {
    showToast(errorMessage(res?.error), true);
  }
}

async function handleSave(slotId, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const res = await send('SAVE_SLOT', { slotId });
  btn.disabled = false;
  btn.textContent = 'Speichern';
  if (res?.ok) {
    showToast('Session gespeichert ✓');
    await render();
  } else {
    showToast(errorMessage(res?.error), true);
  }
}

function errorMessage(code) {
  switch (code) {
    case 'LIMIT_REACHED': return 'Free-Limit erreicht. Pro für mehr Slots.';
    case 'SLOT_EMPTY': return 'Keine gespeicherte Session. Erst speichern!';
    case 'SLOT_NOT_FOUND': return 'Slot nicht gefunden.';
    case 'SESSION_EXPIRED': return 'Session abgelaufen — neu einloggen & speichern.';
    default: return 'Unbekannter Fehler.';
  }
}

// --- Render ---

async function render() {
  const { slots, activeSlotId } = await send('GET_STATE');

  slotList.innerHTML = '';

  if (slots.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <p class="onboarding-title">So funktioniert's</p>
      <ol class="onboarding-steps">
        <li>Auf Twitch mit Account A einloggen</li>
        <li>Slot hinzufügen &amp; <strong>Speichern</strong> klicken</li>
        <li>Auf Twitch mit Account B einloggen</li>
        <li>Zweiten Slot hinzufügen &amp; speichern</li>
        <li>Jetzt kannst du per <strong>Switch</strong> wechseln</li>
      </ol>`;
    slotList.appendChild(empty);
  } else {
    for (const slot of slots) {
      slotList.appendChild(createSlotEl(slot, slot.id === activeSlotId));
    }
  }

  const atLimit = slots.length >= MAX_FREE_SLOTS;
  btnAdd.disabled = atLimit;
  proHint.classList.toggle('hidden', !atLimit);
}

render();
