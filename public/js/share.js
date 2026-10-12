// share.js - Quick Share: short codes that move a query or note between computers.

window.GAP = window.GAP || {};

GAP.share = (() => {
  const { $, h, icon, btn, iconBtn, toast, copyWithToast, confirmDialog, withBusy, setError, fmtDateTime, timeLeft, emptyState } = GAP.ui;
  const api = GAP.api;

  let pending = null;       // content waiting to be placed in the form
  let builtFor = null;      // which sign-in state the form was built for
  let lastCreated = null;

  const linkFor = (code) => `${location.origin}${location.pathname}?share=${code}`;
  const expiryLine = (ts) => `Expires ${fmtDateTime(ts)} (${timeLeft(ts)})`;

  function normalizeCode(raw) {
    const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
  }

  function prefill(data) { pending = data; }

  // ---------- receive ----------
  async function receive(e) {
    if (e) e.preventDefault();
    const input = $('#share-code-input');
    const code = normalizeCode(input.value);
    const out = $('#receive-result');
    if (code.replace('-', '').length !== 8) {
      out.replaceChildren(h('p', { class: 'error form-error', role: 'alert' }, 'Enter the 8-character code, like ABCD-2345.'));
      input.focus();
      return;
    }
    input.value = code;
    await withBusy($('#btn-receive'), 'Opening', async () => {
      try {
        const { share } = await api.getShare(code);
        out.replaceChildren(resultBox(share));
        toast('Code opened.', 'success');
      } catch (err) {
        out.replaceChildren(h('p', { class: 'error form-error', role: 'alert' }, err.retryAfter ? `${err.message}` : err.message));
      }
    });
  }

  function resultBox(s) {
    const needLogin = (what) => { GAP.auth.require('#/share', `Log in to save this ${what} to My Zone.`); };
    return h('div', { class: 'result-box' },
      h('div', { class: 'card-top' }, h('h3', {}, s.title), h('span', { class: 'badge' }, s.subject || 'General')),
      h('div', { class: 'result-meta' },
        h('span', {}, `Shared by ${s.senderName}`),
        h('span', { class: 'expiry' }, icon('clock'), expiryLine(s.expiresAt))),
      h('pre', { class: 'preview full', tabindex: '0' }, s.content),
      h('div', { class: 'result-actions' },
        btn('Copy', { cls: 'btn-secondary btn-sm', ic: 'copy', onclick: () => copyWithToast(s.content, 'Text') }),
        btn('Open in Playground', { cls: 'btn-primary btn-sm', ic: 'play', onclick: () => GAP.playground.load(s.content) }),
        btn('Save as query', { cls: 'btn-secondary btn-sm', ic: 'save', onclick: () => (api.isSignedIn() ? GAP.zone.openQueryDialog({ title: s.title, subject: s.subject, sql: s.content }) : needLogin('query')) }),
        btn('Save as note', { cls: 'btn-secondary btn-sm', ic: 'note', onclick: () => (api.isSignedIn() ? GAP.zone.openNoteDialog({ title: s.title, subject: s.subject, content: s.content }) : needLogin('note')) })));
  }

  // ---------- send ----------
  function buildSend() {
    const body = $('#send-body');
    builtFor = api.isSignedIn();
    if (!builtFor) {
      body.replaceChildren(h('div', { class: 'stack' },
        h('p', { class: 'lede-sm' }, 'Log in to create a code. Anyone you give the code to can open it without an account.'),
        h('div', { class: 'result-actions' },
          h('a', { class: 'btn btn-primary', href: '#/login', onclick: () => GAP.auth.setReturn('#/share') }, 'Log in'),
          h('a', { class: 'btn btn-secondary', href: '#/signup', onclick: () => GAP.auth.setReturn('#/share') }, 'Sign up'))));
      return;
    }
    const form = h('form', { id: 'form-send', class: 'stack', novalidate: true, onsubmit: send },
      h('div', { class: 'field' }, h('label', { for: 'send-title' }, 'Title'), h('input', { id: 'send-title', class: 'input', type: 'text', maxlength: '120', placeholder: 'e.g. DBMS Lab 4: joins' })),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'send-subject' }, 'Subject'), h('input', { id: 'send-subject', class: 'input', type: 'text', maxlength: '60', placeholder: 'e.g. DBMS Lab' })),
        h('div', { class: 'field' }, h('label', { for: 'send-expiry' }, 'Code expires after'),
          h('select', { id: 'send-expiry', class: 'select' },
            [['1', '1 hour'], ['6', '6 hours'], ['24', '24 hours'], ['72', '3 days'], ['168', '7 days']].map(([v, l]) => h('option', { value: v, selected: v === '24' }, l))))),
      h('div', { class: 'field' }, h('label', { for: 'send-content' }, 'Query or note'), h('textarea', { id: 'send-content', class: 'textarea mono', rows: '8', maxlength: '100000', spellcheck: 'false' })),
      h('p', { class: 'error form-error', id: 'send-err', role: 'alert', hidden: true }),
      h('button', { class: 'btn btn-primary', type: 'submit', id: 'btn-send' }, icon('send'), h('span', {}, 'Create code')),
      h('div', { id: 'send-result' }));
    body.replaceChildren(form);
  }

  async function send(e) {
    e.preventDefault();
    const title = $('#send-title').value.trim(), content = $('#send-content').value.trim();
    const err = $('#send-err');
    setError(err, '');
    if (!title) { setError(err, 'Give the share a title.'); $('#send-title').focus(); return; }
    if (!content) { setError(err, 'Add the query or note you want to share.'); $('#send-content').focus(); return; }
    await withBusy($('#btn-send'), 'Creating code', async () => {
      try {
        const { share } = await api.createShare({ title, content, subject: $('#send-subject').value, expiryHours: Number($('#send-expiry').value) });
        lastCreated = share;
        $('#send-result').replaceChildren(createdBox(share));
        $('#send-result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        toast(`Code ${share.code} created.`, 'success');
        loadMine();
      } catch (e2) { setError(err, e2.message); }
    });
  }

  function createdBox(s) {
    return h('div', { class: 'stack' },
      h('div', { class: 'code-display' },
        h('output', { class: 'code-value', 'aria-label': `Share code ${s.code.split('').join(' ')}` }, s.code),
        btn('Copy code', { cls: 'btn-primary btn-sm', ic: 'copy', onclick: () => copyWithToast(s.code, 'Code') })),
      h('div', { class: 'expiry' }, icon('clock'), expiryLine(s.expiresAt)),
      h('div', { class: 'result-actions' },
        btn('Copy link', { cls: 'btn-secondary btn-sm', ic: 'copy', onclick: () => copyWithToast(linkFor(s.code), 'Link') })),
      h('p', { class: 'hint' }, 'On the other computer, open GAP Compiler, go to Quick Share and type this code. Or open the link.'));
  }

  // ---------- my codes ----------
  async function loadMine() {
    const panel = $('#my-shares-panel');
    if (!api.isSignedIn()) { panel.hidden = true; return; }
    try {
      const { shares } = await api.myShares();
      panel.hidden = shares.length === 0;
      $('#my-shares').replaceChildren(h('div', { class: 'share-list' }, shares.map((s) =>
        h('div', { class: 'share-row' },
          h('span', { class: 'code' }, s.code),
          h('div', { class: 'what' }, h('strong', {}, s.title), h('span', {}, expiryLine(s.expiresAt))),
          h('div', { class: 'card-actions' },
            iconBtn('copy', `Copy code ${s.code}`, () => copyWithToast(s.code, 'Code')),
            iconBtn('trash', `Delete code ${s.code}`, () => revoke(s)))))));
    } catch (err) {
      panel.hidden = true;
    }
  }

  async function revoke(s) {
    const ok = await confirmDialog({ title: 'Delete this code?', message: `${s.code} will stop working straight away. Anyone who has not opened it yet will not be able to.`, confirmLabel: 'Delete code' });
    if (!ok) return;
    try {
      await api.deleteShare(s.code);
      toast('Code deleted.', 'success');
      if (lastCreated && lastCreated.code === s.code && $('#send-result')) $('#send-result').replaceChildren();
      loadMine();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- view ----------
  function show() {
    if (builtFor !== api.isSignedIn()) buildSend();
    if (pending && api.isSignedIn()) {
      $('#send-title').value = pending.title || '';
      $('#send-subject').value = pending.subject || '';
      $('#send-content').value = pending.content || '';
      pending = null;
      toast('Added to the form. Choose an expiry and create your code.', 'info');
    }
    loadMine();
  }

  function openCode(code) {
    $('#share-code-input').value = normalizeCode(code);
    receive();
  }

  function init() {
    $('#form-receive').addEventListener('submit', receive);
    $('#share-code-input').addEventListener('input', (e) => {
      const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      e.target.value = clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
    });
    api.onChange(() => { builtFor = null; lastCreated = null; });
  }

  return { init, show, prefill, openCode };
})();
