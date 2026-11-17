(function () {
  'use strict';
  const WIDGET_ID = 'switchr-widget';
  const MENU_SELECTOR = '[data-test-selector="user-menu-dropdown__main-menu"]';
  const pending = new WeakSet();
  let busy = false;
  let invalidated = false;

  async function send(type, payload = {}) {
    const response = await (globalThis.browser || chrome).runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || 'OPERATION_FAILED');
    return response;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function errorMessage(code) {
    return {
      SESSION_EXPIRED: 'Open Switchr in the toolbar to sign in again.',
      SLOT_EMPTY: 'Open Switchr in the toolbar to connect this account.',
      UNSAVED_SESSION: 'Save your current session in the Switchr toolbar popup first.',
      LOGIN_IN_PROGRESS: 'Finish or cancel login in the Switchr toolbar popup.',
      SWITCH_FAILED: 'Switch failed. Your previous cookies were restored.',
      RECOVERY_FAILED: 'Recovery failed. Open Switchr to retry restoring your backup.',
    }[code] || 'Could not switch. Open Switchr in the toolbar to try again.';
  }
  async function buildWidget() {
    const state = await send('GET_STATE');
    const widget = el('section', '', '');
    widget.id = WIDGET_ID;
    widget.setAttribute('aria-label', 'Switchr accounts');
    const header = el('div', 'switchr-widget-header', '');
    header.append(el('span', 'switchr-widget-dot', ''), el('span', '', 'SWITCHR'));
    widget.append(header);
    const feedback = el('p', 'switchr-widget-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    if (!state.slots.length || state.pendingLogin || (state.currentSession && !state.currentSession.saved)) {
      feedback.textContent = state.pendingLogin ? 'Finish connecting your account in the toolbar popup.' :
        state.currentSession ? 'Save this session in the Switchr toolbar popup first.' : 'Connect your first account using Switchr in the toolbar.';
    }
    const list = el('div', 'switchr-widget-list', '');
    for (const slot of state.slots) {
      const active = slot.id === state.activeSlotId;
      const row = el('div', `switchr-widget-row${active ? ' active' : ''}`, '');
      const name = el('span', 'switchr-widget-name', slot.label);
      name.title = slot.label;
      row.append(el('div', 'switchr-monogram', slot.label.slice(0, 2).toUpperCase()), name);
      if (active) row.append(el('span', 'switchr-widget-badge', 'In use'));
      else {
        const connected = slot.status === 'saved';
        const btn = el('button', 'switchr-widget-btn', connected ? 'Switch' : 'Sign in needed');
        btn.type = 'button';
        btn.disabled = !connected || !!state.pendingLogin || !!(state.currentSession && !state.currentSession.saved);
        btn.setAttribute('aria-label', `Switch to ${slot.label}`);
        if (!connected) btn.title = 'Open Switchr in the toolbar to sign in again';
        btn.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          busy = true;
          const disabledStates = new Map([...widget.querySelectorAll('button')].map(button => [button, button.disabled]));
          widget.querySelectorAll('button').forEach(button => { button.disabled = true; });
          btn.textContent = 'Switching…';
          try {
            const result = await send('SWITCH_TO_SLOT', { slotId: slot.id });
            feedback.textContent = result.reloadWarning ? 'Switched. Reload Twitch to continue.' : `Switched to ${slot.label}.`;
          } catch (error) {
            feedback.textContent = errorMessage(error.message);
            feedback.setAttribute('role', 'alert');
          } finally {
            busy = false;
            btn.textContent = 'Switch';
            widget.querySelectorAll('button').forEach(button => {
              button.disabled = disabledStates.get(button);
            });
          }
        });
        row.append(btn);
      }
      list.append(row);
    }
    widget.append(list, feedback);
    return widget;
  }
  async function injectIntoMenu(menu, refresh = false) {
    if (invalidated || pending.has(menu) || busy || (!refresh && menu.querySelector('#' + WIDGET_ID))) return;
    pending.add(menu);
    try {
      const widget = await buildWidget();
      if (!menu.isConnected) return;
      const existing = menu.querySelector('#' + WIDGET_ID);
      if (existing) existing.replaceWith(widget);
      else {
        const anchor = menu.querySelector('[data-test-selector="user-menu-dropdown__channel-link"]')?.parentElement;
        if (anchor) anchor.insertAdjacentElement('beforebegin', widget);
        else menu.prepend(widget);
      }
    } catch {
      // Old content scripts can outlive an extension update; a Twitch reload repairs them.
      if (!chrome.runtime.id) { invalidated = true; observer.disconnect(); }
    } finally { pending.delete(menu); }
  }
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const menu = node.matches?.(MENU_SELECTOR) ? node : node.querySelector?.(MENU_SELECTOR);
        if (menu) injectIntoMenu(menu);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => {
    const menu = document.querySelector(MENU_SELECTOR);
    if (menu) injectIntoMenu(menu, true);
  });
  const existing = document.querySelector(MENU_SELECTOR);
  if (existing) injectIntoMenu(existing);
})();
