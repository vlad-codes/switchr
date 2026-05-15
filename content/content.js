(function () {
  'use strict';

  const WIDGET_ID = 'switchr-widget';

  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, payload });
  }

  function makeMonogram(label) {
    const el = document.createElement('div');
    el.className = 'switchr-monogram';
    el.textContent = label.slice(0, 2).toUpperCase();
    return el;
  }

  async function buildWidget() {
    const { slots, activeSlotId } = await send('GET_STATE');

    const widget = document.createElement('div');
    widget.id = WIDGET_ID;

    const header = document.createElement('div');
    header.className = 'switchr-widget-header';

    const dot = document.createElement('div');
    dot.className = 'switchr-widget-dot';

    const title = document.createElement('span');
    title.textContent = 'SWITCHR';

    header.append(dot, title);
    widget.appendChild(header);

    if (slots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'switchr-widget-empty';
      empty.textContent = 'No accounts saved yet.';
      widget.appendChild(empty);
      return widget;
    }

    const list = document.createElement('div');
    list.className = 'switchr-widget-list';

    slots.forEach(slot => {
      const row = document.createElement('div');
      row.className = 'switchr-widget-row' + (slot.id === activeSlotId ? ' active' : '');

      const mono = makeMonogram(slot.label);

      const name = document.createElement('span');
      name.className = 'switchr-widget-name';
      name.textContent = slot.label;

      const actions = document.createElement('div');
      actions.className = 'switchr-widget-actions';

      if (slot.id === activeSlotId) {
        const badge = document.createElement('span');
        badge.className = 'switchr-widget-badge';
        badge.textContent = 'active';
        actions.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'switchr-widget-btn';
        btn.textContent = 'switch';
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          btn.textContent = '...';
          btn.disabled = true;
          await send('SWITCH_TO_SLOT', { slotId: slot.id });
        });
        actions.appendChild(btn);
      }

      row.append(mono, name, actions);
      list.appendChild(row);
    });

    widget.appendChild(list);
    return widget;
  }

  async function injectIntoMenu(menu) {
    if (menu.querySelector('#' + WIDGET_ID)) return;

    const widget = await buildWidget();

    // Try to inject before the "Channel" link; fall back to prepending so a
    // Twitch selector change doesn't silently break injection entirely.
    const channelLink = menu.querySelector('[data-test-selector="user-menu-dropdown__channel-link"]');
    const anchor = channelLink?.parentElement;
    if (anchor) {
      anchor.insertAdjacentElement('beforebegin', widget);
    } else {
      menu.prepend(widget);
    }
  }

  // Twitch uses data-test-selector attributes internally — these can change
  // without notice. If the widget stops appearing, inspect the profile dropdown
  // and update these selectors to match the current DOM.
  const MENU_SELECTOR = '[data-test-selector="user-menu-dropdown__main-menu"]';

  function findMenu() {
    return document.querySelector(MENU_SELECTOR);
  }

  // Watch for the Twitch dropdown to open / re-open
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(MENU_SELECTOR)) { injectIntoMenu(node); return; }
        const found = node.querySelector?.(MENU_SELECTOR);
        if (found) { injectIntoMenu(found); return; }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  const existing = findMenu();
  if (existing) injectIntoMenu(existing);
})();
