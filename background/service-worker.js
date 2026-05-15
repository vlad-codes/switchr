function generateId() {
  return crypto.randomUUID();
}

async function getStorage() {
  const data = await chrome.storage.local.get(['slots', 'activeSlotId']);
  return {
    slots: data.slots ?? [],
    activeSlotId: data.activeSlotId ?? null,
  };
}

async function setStorage(updates) {
  await chrome.storage.local.set(updates);
}

async function getAllTwitchCookies() {
  return chrome.cookies.getAll({ domain: 'twitch.tv' });
}

function cookieToSetDetails(cookie) {
  const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
  const details = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
  // Only set domain if it's a domain cookie (starts with dot)
  if (cookie.domain.startsWith('.')) {
    details.domain = cookie.domain.replace(/^\./, '');
  }
  // Only set expirationDate if it's a persistent cookie
  if (!cookie.session && cookie.expirationDate) {
    details.expirationDate = cookie.expirationDate;
  }
  return details;
}

async function removeAllTwitchCookies() {
  const cookies = await getAllTwitchCookies();
  await Promise.all(
    cookies.map((cookie) => {
      const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      return chrome.cookies.remove({ url, name: cookie.name });
    })
  );
}

async function reloadTwitchTabs() {
  const tabs = await chrome.tabs.query({ url: '*://*.twitch.tv/*' });
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  return tabs.length;
}

// --- Handlers ---

async function handleSaveSlot({ slotId }) {
  const { slots, activeSlotId } = await getStorage();
  const idx = slots.findIndex((s) => s.id === slotId);
  if (idx === -1) return { ok: false, error: 'SLOT_NOT_FOUND' };

  const cookies = await getAllTwitchCookies();
  slots[idx].cookies = cookies;
  slots[idx].savedAt = Date.now();

  await setStorage({ slots, activeSlotId: slotId });
  return { ok: true };
}

async function handleSwitchToSlot({ slotId }) {
  const { slots } = await getStorage();
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: 'SLOT_NOT_FOUND' };
  if (!slot.cookies || slot.cookies.length === 0) {
    return { ok: false, error: 'SLOT_EMPTY' };
  }

  await removeAllTwitchCookies();

  const results = await Promise.allSettled(
    slot.cookies.map((cookie) => chrome.cookies.set(cookieToSetDetails(cookie)))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected' || r.value === null) {
      console.warn('[TAS] cookie set failed:', slot.cookies[i]?.name, r.reason ?? 'null result');
    }
  });

  const authToken = await chrome.cookies.get({ url: 'https://www.twitch.tv/', name: 'auth-token' });
  if (!authToken) {
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  await setStorage({ activeSlotId: slotId });
  const tabCount = await reloadTwitchTabs();
  return { ok: true, noTabs: tabCount === 0 };
}

async function handleAddSlot({ label }) {
  const { slots, activeSlotId } = await getStorage();

  const newSlot = {
    id: generateId(),
    label: label || `Account ${slots.length + 1}`,
    cookies: [],
    savedAt: null,
  };

  await setStorage({ slots: [...slots, newSlot], activeSlotId });
  return { ok: true, slot: newSlot };
}

async function handleDeleteSlot({ slotId }) {
  const { slots, activeSlotId } = await getStorage();
  const filtered = slots.filter((s) => s.id !== slotId);
  const newActiveId = activeSlotId === slotId ? null : activeSlotId;
  await setStorage({ slots: filtered, activeSlotId: newActiveId });
  return { ok: true };
}

async function handleRenameSlot({ slotId, label }) {
  const { slots, activeSlotId } = await getStorage();
  const idx = slots.findIndex((s) => s.id === slotId);
  if (idx === -1) return { ok: false, error: 'SLOT_NOT_FOUND' };
  slots[idx].label = label;
  await setStorage({ slots, activeSlotId });
  return { ok: true };
}

async function handleGetState() {
  const { slots, activeSlotId } = await getStorage();

  // Detect active slot by matching current browser auth-token against saved slots
  const currentToken = await chrome.cookies.get({ url: 'https://www.twitch.tv/', name: 'auth-token' });
  let detectedActiveId = null;
  if (currentToken) {
    const match = slots.find((s) =>
      s.cookies?.some((c) => c.name === 'auth-token' && c.value === currentToken.value)
    );
    detectedActiveId = match?.id ?? null;
  }

  return { slots, activeSlotId: detectedActiveId ?? activeSlotId };
}

// --- Message Router ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SAVE_SLOT: handleSaveSlot,
    SWITCH_TO_SLOT: handleSwitchToSlot,
    ADD_SLOT: handleAddSlot,
    DELETE_SLOT: handleDeleteSlot,
    RENAME_SLOT: handleRenameSlot,
    GET_STATE: handleGetState,
  };

  const handler = handlers[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    return false;
  }

  handler(message.payload ?? {}).then(sendResponse);
  return true; // keep message channel open for async response
});
