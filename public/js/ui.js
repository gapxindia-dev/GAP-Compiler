// ui.js - small DOM helpers shared by every view.
// Dynamic content is built with h() so user text is always inserted as text, never as HTML.

window.GAP = window.GAP || {};

GAP.ui = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    append(el, children);
    return el;
  }

  function icon(name, cls = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `icon ${cls}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function btn(label, { cls = 'btn-secondary', ic, onclick, type = 'button', title, aria, data } = {}) {
    const b = h('button', { class: `btn ${cls}`, type, title, 'aria-label': aria, onclick });
    if (ic) b.append(icon(ic));
    b.append(h('span', {}, label));
    if (data) Object.assign(b.dataset, data);
    return b;
  }

  function iconBtn(ic, label, onclick, cls = '') {
    return h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, onclick }, icon(ic));
  }

  // ---- toasts ----
  function toast(message, type = 'info') {
    const box = $('#toasts');
    const node = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
      icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'alert'),
      h('span', {}, message));
    box.append(node);
    while (box.children.length > 4) box.firstElementChild.remove();
    const leave = () => { node.classList.add('leaving'); setTimeout(() => node.remove(), 220); };
    setTimeout(leave, type === 'error' ? 6000 : 3800);
  }

  // ---- dialogs ----
  function openDialog(dlg) {
    if (!dlg.open) dlg.showModal();
  }
  function closeDialog(dlg) {
    if (dlg.open) dlg.close();
  }
  function initDialogs() {
    for (const dlg of $$('dialog')) {
      let downOnBackdrop = false;
      dlg.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dlg; });
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg && downOnBackdrop && dlg.id !== 'dlg-confirm') dlg.close();
      });
      dlg.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) dlg.close();
      });
    }
  }

  function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
    const dlg = $('#dlg-confirm');
    $('#dlg-confirm-title').textContent = title;
    $('#dlg-confirm-msg').textContent = message;
    const ok = $('#confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    return new Promise((resolve) => {
      const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); };
      dlg.returnValue = '';
      dlg.addEventListener('close', done);
      dlg.showModal();
    });
  }

  // Runs fn while the button shows a spinner. Ignores clicks while busy (no double submits).
  async function withBusy(button, label, fn) {
    if (button.getAttribute('aria-busy') === 'true') return undefined;
    const original = [...button.childNodes];
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, label));
    try {
      return await fn();
    } finally {
      button.replaceChildren(...original);
      button.removeAttribute('aria-busy');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1' });
      ta.value = text;
      ta.className = 'sr-only';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }
  async function copyWithToast(text, what) {
    const ok = await copyText(text);
    toast(ok ? `${what} copied.` : `Could not copy. Select the text and copy it manually.`, ok ? 'success' : 'error');
  }

  // ---- forms ----
  function setError(el, message) {
    el.textContent = message || '';
    el.hidden = !message;
  }
  function fieldError(input, message) {
    const err = document.getElementById(`${input.id}-err`);
    if (err) setError(err, message);
    if (message) { input.setAttribute('aria-invalid', 'true'); if (err) input.setAttribute('aria-describedby', err.id); }
    else { input.removeAttribute('aria-invalid'); }
  }

  // ---- formatting ----
  const fmtDate = (v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (v) => new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function timeLeft(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return 'expired';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} min left`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours} h ${mins % 60} min left`;
    return `${Math.round(hours / 24)} days left`;
  }

  function emptyState({ title, text, actions = [], ic = 'db' }) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-mark' }, icon(ic)),
      h('h2', {}, title),
      h('p', {}, text),
      actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
  }

  function skeletons(n = 3) {
    return h('div', { class: 'grid', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
  }

  return {
    $, $$, h, icon, btn, iconBtn, toast, openDialog, closeDialog, initDialogs, confirmDialog,
    withBusy, copyText, copyWithToast, setError, fieldError, fmtDate, fmtDateTime, timeLeft, emptyState, skeletons
  };
})();
