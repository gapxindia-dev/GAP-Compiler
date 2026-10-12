// zone.js - My Zone: each student's private saved queries and notes.

window.GAP = window.GAP || {};

GAP.zone = (() => {
  const { $, h, icon, btn, iconBtn, toast, openDialog, closeDialog, confirmDialog, withBusy, setError, fmtDate, emptyState, skeletons } = GAP.ui;
  const api = GAP.api;

  let data = { queries: [], notes: [] };
  const filter = { text: '', type: 'all', subject: 'all' };
  let loading = false;

  const body = () => $('#zone-body');
  const total = () => data.queries.length + data.notes.length;

  function updateCount() {
    const badge = $('#zone-count');
    badge.hidden = !api.isSignedIn() || total() === 0;
    badge.textContent = total();
  }

  // ---------- view ----------
  async function show() {
    const signedIn = api.isSignedIn();
    $('#zone-actions').hidden = !signedIn;
    if (!signedIn) {
      data = { queries: [], notes: [] };
      updateCount();
      $('#zone-lede').textContent = 'Your saved queries and notes, available on any device.';
      body().replaceChildren(emptyState({
        ic: 'zone',
        title: 'Log in to open My Zone',
        text: 'Save SQL queries and notes at school, then open them from home or your phone. Only you can see what is in your Zone.',
        actions: [
          h('a', { class: 'btn btn-primary', href: '#/login', onclick: () => GAP.auth.setReturn('#/zone') }, 'Log in'),
          h('a', { class: 'btn btn-secondary', href: '#/signup', onclick: () => GAP.auth.setReturn('#/zone') }, 'Sign up')
        ]
      }));
      return;
    }
    $('#zone-lede').textContent = `Saved queries and notes for ${api.student().fullName}.`;
    if (loading) return;
    loading = true;
    if (!total()) body().replaceChildren(skeletons(3));
    try {
      data = await api.getZone();
      updateCount();
      build();
    } catch (err) {
      body().replaceChildren(emptyState({
        ic: 'alert', title: 'My Zone did not load', text: err.message,
        actions: [btn('Try again', { cls: 'btn-primary', onclick: show })]
      }));
    } finally {
      loading = false;
    }
  }

  function build() {
    if (!total()) {
      body().replaceChildren(emptyState({
        ic: 'zone',
        title: 'Your Zone is ready.',
        text: 'Save your first SQL query or create a note to get started.',
        actions: [
          btn('Create Query', { cls: 'btn-primary', ic: 'plus', onclick: () => openQueryDialog() }),
          btn('Add Note', { cls: 'btn-secondary', ic: 'plus', onclick: () => openNoteDialog() })
        ]
      }));
      return;
    }
    const subjects = [...new Set([...data.queries, ...data.notes].map((i) => i.subject).filter(Boolean))].sort();
    if (filter.subject !== 'all' && !subjects.includes(filter.subject)) filter.subject = 'all';

    const search = h('input', {
      id: 'zone-search', class: 'input', type: 'search', placeholder: 'Search titles, SQL, notes and tags', value: filter.text,
      oninput: (e) => { filter.text = e.target.value; renderList(); }
    });
    const typeSel = h('select', { id: 'zone-type', class: 'select select-sm', 'aria-label': 'Show', onchange: (e) => { filter.type = e.target.value; renderList(); } },
      h('option', { value: 'all' }, 'Queries and notes'), h('option', { value: 'queries' }, 'Queries only'), h('option', { value: 'notes' }, 'Notes only'));
    typeSel.value = filter.type;
    const subjSel = h('select', { id: 'zone-subject', class: 'select select-sm', 'aria-label': 'Subject', onchange: (e) => { filter.subject = e.target.value; renderList(); } },
      h('option', { value: 'all' }, 'All subjects'), subjects.map((s) => h('option', { value: s }, s)));
    subjSel.value = filter.subject;

    body().replaceChildren(
      h('div', { class: 'filters' },
        h('div', { class: 'search' }, icon('search'), h('label', { class: 'sr-only', for: 'zone-search' }, 'Search My Zone'), search),
        h('div', { class: 'filter-group' }, typeSel, subjSel)),
      h('div', { id: 'zone-list' }));
    renderList();
  }

  function matches(item, text) {
    if (!text) return true;
    const t = text.toLowerCase();
    return [item.title, item.sql, item.content, item.notes, item.subject, (item.tags || []).join(' ')]
      .some((f) => f && f.toLowerCase().includes(t));
  }

  function renderList() {
    const list = $('#zone-list');
    if (!list) return;
    let items = [];
    if (filter.type !== 'notes') items.push(...data.queries.map((q) => ({ ...q, kind: 'query' })));
    if (filter.type !== 'queries') items.push(...data.notes.map((n) => ({ ...n, kind: 'note' })));
    items = items.filter((i) => (filter.subject === 'all' || i.subject === filter.subject) && matches(i, filter.text.trim()));
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    if (!items.length) {
      list.replaceChildren(emptyState({
        ic: 'search', title: 'Nothing matches', text: 'No saved item fits that search. Try different words or clear the filters.',
        actions: [btn('Clear filters', { cls: 'btn-secondary', onclick: () => { filter.text = ''; filter.type = 'all'; filter.subject = 'all'; build(); } })]
      }));
      return;
    }
    list.replaceChildren(h('div', { class: 'grid' }, items.map(card)));
  }

  function card(item) {
    const isQuery = item.kind === 'query';
    return h('article', { class: 'card' },
      h('div', { class: 'card-top' },
        h('span', { class: 'kind' }, icon(isQuery ? 'db' : 'note'), isQuery ? 'Query' : 'Note'),
        h('span', { class: 'badge' }, item.subject || 'General')),
      h('h3', {}, item.title),
      h('pre', { class: `preview${isQuery ? '' : ' prose'}` }, isQuery ? item.sql : item.content),
      isQuery && item.notes ? h('p', { class: 'card-desc' }, item.notes) : null,
      item.tags && item.tags.length ? h('div', { class: 'tag-row' }, item.tags.map((t) => h('span', { class: 'tag' }, `#${t}`))) : null,
      h('div', { class: 'card-foot' },
        h('span', { class: 'card-meta' }, `Updated ${fmtDate(item.updatedAt)}`),
        h('div', { class: 'card-actions' },
          isQuery ? btn('Open', { cls: 'btn-primary btn-sm', ic: 'play', title: 'Open in SQL Playground and run', onclick: () => GAP.playground.load(item.sql) }) : null,
          iconBtn('send', 'Share with Quick Share', () => { GAP.share.prefill({ title: item.title, subject: item.subject, content: isQuery ? item.sql : item.content }); location.hash = '#/share'; }),
          iconBtn('edit', `Edit ${item.title}`, () => (isQuery ? openQueryDialog(item) : openNoteDialog(item))),
          iconBtn('trash', `Delete ${item.title}`, () => remove(item, isQuery)))));
  }

  async function remove(item, isQuery) {
    const ok = await confirmDialog({
      title: `Delete this ${isQuery ? 'query' : 'note'}?`,
      message: `"${item.title}" will be removed from My Zone. This cannot be undone.`
    });
    if (!ok) return;
    try {
      await (isQuery ? api.deleteQuery(item.id) : api.deleteNote(item.id));
      data[isQuery ? 'queries' : 'notes'] = data[isQuery ? 'queries' : 'notes'].filter((x) => x.id !== item.id);
      updateCount();
      build();
      toast(`${isQuery ? 'Query' : 'Note'} deleted.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- dialogs ----------
  function openQueryDialog(item = {}) {
    $('#dlg-query-title').textContent = item.id ? 'Edit query' : 'Save query';
    $('#q-submit').textContent = item.id ? 'Save changes' : 'Save query';
    $('#q-id').value = item.id || '';
    $('#q-title').value = item.title || '';
    $('#q-subject').value = item.subject || '';
    $('#q-tags').value = (item.tags || []).join(', ');
    $('#q-sql').value = item.sql || '';
    $('#q-notes').value = item.notes || '';
    setError($('#q-err'), '');
    openDialog($('#dlg-query'));
    setTimeout(() => $(item.title ? '#q-sql' : '#q-title').focus(), 0);
  }

  function openNoteDialog(item = {}) {
    $('#dlg-note-title').textContent = item.id ? 'Edit note' : 'Add note';
    $('#n-submit').textContent = item.id ? 'Save changes' : 'Save note';
    $('#n-id').value = item.id || '';
    $('#n-title').value = item.title || '';
    $('#n-subject').value = item.subject || '';
    $('#n-tags').value = (item.tags || []).join(', ');
    $('#n-content').value = item.content || '';
    setError($('#n-err'), '');
    openDialog($('#dlg-note'));
    setTimeout(() => $('#n-title').focus(), 0);
  }

  async function saveQuery(e) {
    e.preventDefault();
    const title = $('#q-title').value.trim(), sql = $('#q-sql').value.trim();
    if (!title) { setError($('#q-err'), 'Give the query a title.'); $('#q-title').focus(); return; }
    if (!sql) { setError($('#q-err'), 'The SQL cannot be empty.'); $('#q-sql').focus(); return; }
    setError($('#q-err'), '');
    const id = $('#q-id').value;
    await withBusy($('#q-submit'), 'Saving', async () => {
      try {
        await api.saveQuery(id, { title, sql, subject: $('#q-subject').value, tags: $('#q-tags').value, notes: $('#q-notes').value });
        closeDialog($('#dlg-query'));
        toast(id ? 'Query updated.' : 'Query saved to My Zone.', 'success');
        await refresh();
      } catch (err) { setError($('#q-err'), err.message); }
    });
  }

  async function saveNote(e) {
    e.preventDefault();
    const title = $('#n-title').value.trim(), content = $('#n-content').value.trim();
    if (!title) { setError($('#n-err'), 'Give the note a title.'); $('#n-title').focus(); return; }
    if (!content) { setError($('#n-err'), 'The note cannot be empty.'); $('#n-content').focus(); return; }
    setError($('#n-err'), '');
    const id = $('#n-id').value;
    await withBusy($('#n-submit'), 'Saving', async () => {
      try {
        await api.saveNote(id, { title, content, subject: $('#n-subject').value, tags: $('#n-tags').value });
        closeDialog($('#dlg-note'));
        toast(id ? 'Note updated.' : 'Note saved to My Zone.', 'success');
        await refresh();
      } catch (err) { setError($('#n-err'), err.message); }
    });
  }

  // Re-fetch from the server so the screen always matches what is stored.
  async function refresh() {
    try { data = await api.getZone(); updateCount(); if ($('#view-zone').hidden === false) build(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function exportAs(format, filename, button) {
    await withBusy(button, 'Preparing', async () => {
      try { await api.exportZone(format, filename); toast('Download started.', 'success'); }
      catch (err) { toast(err.message, 'error'); }
    });
  }

  function init() {
    $('#form-query').addEventListener('submit', saveQuery);
    $('#form-note').addEventListener('submit', saveNote);
    $('#btn-new-query').addEventListener('click', () => openQueryDialog());
    $('#btn-new-note').addEventListener('click', () => openNoteDialog());
    $('#btn-export-sql').addEventListener('click', (e) => exportAs('sql', 'my-zone-queries.sql', e.currentTarget));
    $('#btn-export-json').addEventListener('click', (e) => exportAs('json', 'my-zone-backup.json', e.currentTarget));
    api.onChange(() => { data = { queries: [], notes: [] }; Object.assign(filter, { text: '', type: 'all', subject: 'all' }); updateCount(); });
  }

  // Also used to save a query that came from the Class Board or Quick Share.
  return { init, show, openQueryDialog, openNoteDialog, refresh };
})();
