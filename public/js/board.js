// board.js - Class Board: queries and notes posted by students. Only authors can delete their posts.

window.GAP = window.GAP || {};

GAP.board = (() => {
  const { $, $$, h, icon, btn, toast, openDialog, closeDialog, confirmDialog, withBusy, setError, fmtDate, emptyState, skeletons } = GAP.ui;
  const api = GAP.api;

  const filter = { text: '', tag: '' };
  let posts = [];
  let tags = [];
  let total = 0;
  let timer = null;
  let requestId = 0;

  const body = () => $('#board-body');

  async function show() {
    const mine = ++requestId;
    if (!posts.length) body().replaceChildren(skeletons(3));
    try {
      const res = await api.getBoard({ query: filter.text.trim(), tag: filter.tag });
      if (mine !== requestId) return; // a newer request replaced this one
      posts = res.community; tags = res.tags; total = res.total;
      render();
    } catch (err) {
      body().replaceChildren(emptyState({
        ic: 'alert', title: 'The board did not load', text: err.message,
        actions: [btn('Try again', { cls: 'btn-primary', onclick: show })]
      }));
    }
  }

  function render() {
    $('#board-filters').hidden = total === 0;
    renderTags();
    if (total === 0) {
      body().replaceChildren(emptyState({
        ic: 'users',
        title: 'Nothing on the board yet.',
        text: 'Be the first to share a query or a note with your class.',
        actions: [
          btn('Share Query', { cls: 'btn-primary', ic: 'plus', onclick: () => openPost('query') }),
          btn('Add Note', { cls: 'btn-secondary', ic: 'plus', onclick: () => openPost('note') })
        ]
      }));
      return;
    }
    if (!posts.length) {
      body().replaceChildren(emptyState({
        ic: 'search', title: 'Nothing matches', text: 'No post fits that search. Try different words or clear the filters.',
        actions: [btn('Clear filters', { cls: 'btn-secondary', onclick: () => { filter.text = ''; filter.tag = ''; $('#board-search').value = ''; show(); } })]
      }));
      return;
    }
    body().replaceChildren(h('div', { class: 'grid' }, posts.map(card)));
  }

  function renderTags() {
    const row = $('#board-tags');
    const mk = (label, value) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(filter.tag === value),
      onclick: () => { filter.tag = value; show(); }
    }, label);
    row.replaceChildren(...(tags.length ? [mk('All', ''), ...tags.map((t) => mk(`#${t}`, t))] : []));
  }

  function card(p) {
    const isQuery = p.type !== 'note';
    const text = isQuery ? p.sql : p.content;
    const long = text.length > 260 || text.split('\n').length > 7;
    const pre = h('pre', { class: `preview${isQuery ? '' : ' prose'}` }, text);
    const more = long ? h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', 'aria-expanded': 'false',
      onclick: (e) => {
        const open = pre.classList.toggle('full');
        e.currentTarget.setAttribute('aria-expanded', String(open));
        e.currentTarget.textContent = open ? 'Show less' : 'Show more';
      }
    }, 'Show more') : null;

    const vote = h('button', {
      class: 'btn btn-ghost btn-sm vote', type: 'button', 'aria-pressed': String(p.liked), 'aria-label': `Upvote, ${p.upvotes} so far`,
      onclick: (e) => upvote(p, e.currentTarget)
    }, icon('thumb'), h('span', { class: 'count' }, p.upvotes));

    return h('article', { class: 'card', 'data-post': p.id },
      h('div', { class: 'card-top' },
        h('span', { class: 'kind' }, icon(isQuery ? 'db' : 'note'), isQuery ? 'Query' : 'Note'),
        h('span', { class: 'badge' }, p.subject || 'General')),
      h('h3', {}, p.title),
      h('p', { class: 'card-meta' }, `By ${p.author || 'a student'} on ${fmtDate(p.createdAt)}`),
      p.description ? h('p', { class: 'card-desc' }, p.description) : null,
      pre, more,
      p.tags.length ? h('div', { class: 'tag-row' }, p.tags.map((t) => h('span', { class: 'tag' }, `#${t}`))) : null,
      h('div', { class: 'card-foot' },
        vote,
        h('div', { class: 'card-actions' },
          isQuery ? btn('Try it', { cls: 'btn-primary btn-sm', ic: 'play', title: 'Open in SQL Playground and run', onclick: () => GAP.playground.load(p.sql) }) : null,
          btn('Save', { cls: 'btn-secondary btn-sm', ic: 'save', title: 'Save a copy to My Zone', onclick: () => saveCopy(p, isQuery) }),
          p.mine ? btn('Delete', { cls: 'btn-ghost btn-sm btn-outline-danger', ic: 'trash', aria: `Delete your post ${p.title}`, onclick: () => remove(p) }) : null)));
  }

  async function upvote(p, button) {
    if (!api.isSignedIn()) { GAP.auth.require('#/board', 'Log in to upvote posts.'); return; }
    try {
      const res = await api.toggleLike(p.id);
      p.upvotes = res.upvotes; p.liked = res.liked;
      button.setAttribute('aria-pressed', String(res.liked));
      button.setAttribute('aria-label', `Upvote, ${res.upvotes} so far`);
      button.querySelector('.count').textContent = res.upvotes;
    } catch (err) { toast(err.message, 'error'); }
  }

  function saveCopy(p, isQuery) {
    if (!api.isSignedIn()) { GAP.auth.require('#/board', 'Log in to save posts to My Zone.'); return; }
    if (isQuery) GAP.zone.openQueryDialog({ title: p.title, subject: p.subject, sql: p.sql, tags: p.tags, notes: p.description });
    else GAP.zone.openNoteDialog({ title: p.title, subject: p.subject, content: p.content, tags: p.tags });
  }

  async function remove(p) {
    const ok = await confirmDialog({ title: 'Delete your post?', message: `"${p.title}" will be removed from the Class Board for everyone. This cannot be undone.` });
    if (!ok) return;
    try {
      await api.deletePost(p.id);
      toast('Post deleted.', 'success');
      await show(); // reload from the server so the list matches what is stored
    } catch (err) {
      toast(err.message, 'error'); // the post stays on screen when deletion fails
      if (err.status === 404) show();
    }
  }

  // ---------- posting ----------
  function setType(type) {
    $('#p-sql-field').hidden = type !== 'query';
    $('#p-content-field').hidden = type !== 'note';
    $('#dlg-post-title').textContent = type === 'query' ? 'Share a query' : 'Add a note';
    for (const r of $$('input[name="post-type"]')) r.checked = r.value === type;
  }

  function openPost(type) {
    if (!api.isSignedIn()) { GAP.auth.require('#/board', 'Log in to post on the Class Board.'); return; }
    setType(type);
    for (const id of ['p-title', 'p-subject', 'p-tags', 'p-content', 'p-desc']) $(`#${id}`).value = '';
    $('#p-sql').value = type === 'query' ? ($('#sql-editor').value || '') : '';
    setError($('#p-err'), '');
    openDialog($('#dlg-post'));
    setTimeout(() => $('#p-title').focus(), 0);
  }

  async function submitPost(e) {
    e.preventDefault();
    const type = $('input[name="post-type"]:checked').value;
    const title = $('#p-title').value.trim();
    const sql = $('#p-sql').value.trim(), content = $('#p-content').value.trim();
    const err = $('#p-err');
    if (!title) { setError(err, 'Give your post a title.'); $('#p-title').focus(); return; }
    if (type === 'query' && !sql) { setError(err, 'Add the SQL you want to share.'); $('#p-sql').focus(); return; }
    if (type === 'note' && !content) { setError(err, 'Write the note you want to share.'); $('#p-content').focus(); return; }
    setError(err, '');
    await withBusy($('#p-submit'), 'Posting', async () => {
      try {
        await api.post({ type, title, subject: $('#p-subject').value, tags: $('#p-tags').value, description: $('#p-desc').value, sql, content });
        closeDialog($('#dlg-post'));
        toast('Posted to the Class Board.', 'success');
        filter.text = ''; filter.tag = ''; $('#board-search').value = '';
        await show();
      } catch (e2) { setError(err, e2.message); }
    });
  }

  function init() {
    $('#btn-board-query').addEventListener('click', () => openPost('query'));
    $('#btn-board-note').addEventListener('click', () => openPost('note'));
    $('#form-post').addEventListener('submit', submitPost);
    for (const r of $$('input[name="post-type"]')) r.addEventListener('change', () => setType(r.value));
    $('#board-search').addEventListener('input', (e) => {
      filter.text = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(show, 250);
    });
    api.onChange(() => { posts = []; if (!$('#view-board').hidden) show(); });
  }

  return { init, show };
})();
