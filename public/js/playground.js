// playground.js - the SQL editor, results table and table browser.

window.GAP = window.GAP || {};

GAP.playground = (() => {
  const { $, h, icon, toast, copyWithToast } = GAP.ui;
  const ROW_RENDER_LIMIT = 1000;
  let last = null; // last successful rows result, for CSV
  let engineOk = false;

  const editor = () => $('#sql-editor');
  const sqlText = () => editor().value;

  function updateGutter() {
    const lines = editor().value.split('\n').length;
    $('#gutter').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    $('#gutter').scrollTop = editor().scrollTop;
  }

  function setStatus(text, kind) {
    const s = $('#status');
    s.textContent = text;
    s.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function setMeta(res) {
    const t = $('#meta-time'), r = $('#meta-rows');
    t.hidden = res.execTimeMs === undefined;
    t.textContent = `${res.execTimeMs} ms`;
    r.hidden = res.kind !== 'rows';
    if (res.kind === 'rows') r.textContent = `${res.rowCount.toLocaleString()} row${res.rowCount === 1 ? '' : 's'}`;
    $('#output-actions').hidden = res.kind !== 'rows';
  }

  function renderTable(res) {
    const shown = res.values.slice(0, ROW_RENDER_LIMIT);
    const head = h('tr', {}, h('th', { class: 'rownum', scope: 'col' }, '#'), res.columns.map((c) => h('th', { scope: 'col' }, c)));
    const body = shown.map((row, i) => h('tr', {},
      h('td', { class: 'rownum' }, i + 1),
      row.map((v) => (v === null ? h('td', { class: 'null' }, 'NULL') : h('td', {}, String(v))))));
    const out = $('#output');
    out.replaceChildren(h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Query results' },
      h('table', { class: 'data' }, h('thead', {}, head), h('tbody', {}, body))));
    const notes = [];
    if (res.values.length > ROW_RENDER_LIMIT) {
      notes.push(`Showing the first ${ROW_RENDER_LIMIT.toLocaleString()} of ${res.rowCount.toLocaleString()} rows. CSV export includes all rows.`);
    }
    if (res.resultSets > 1) notes.push(`Your script produced ${res.resultSets} result sets. Showing the last one.`);
    if (notes.length) out.append(h('p', { class: 'note-line' }, notes.join(' ')));
  }

  function run() {
    if (!engineOk) { toast('The SQL engine is not ready.', 'error'); return; }
    const code = sqlText();
    if (!code.trim()) { toast('Write a query first.', 'error'); editor().focus(); return; }
    setStatus('Running', '');
    const res = GAP.sql.execute(code);
    last = null;
    if (!res.success) {
      setStatus('Error', 'err');
      setMeta({ execTimeMs: res.execTimeMs, kind: 'error' });
      $('#output').replaceChildren(h('div', { class: 'sql-error', role: 'alert' },
        h('h3', {}, 'SQL error'), h('pre', {}, res.error), res.tip ? h('p', {}, res.tip) : null));
      return;
    }
    setStatus('Done', 'ok');
    setMeta(res);
    if (res.kind === 'rows') {
      last = res;
      renderTable(res);
    } else {
      $('#output').replaceChildren(h('div', { class: 'done' }, h('div', {}, h('strong', {}, res.kind === 'empty' ? 'No rows' : 'Done'), res.message)));
    }
    if (res.kind === 'command') renderTables(); // CREATE / DROP / INSERT may change the schema or counts
  }

  function renderTables() {
    const tables = GAP.sql.inspectTables();
    $('#table-count').textContent = tables.length;
    const list = $('#table-list');
    if (!tables.length) {
      list.replaceChildren(h('div', { class: 'side-empty' }, 'No tables yet. Create one with CREATE TABLE, then it appears here.'));
      return;
    }
    list.replaceChildren(...tables.map((t) => {
      const prev = GAP.sql.previewRows(t.name, 3);
      return h('div', { class: 'tbl' },
        h('button', {
          class: 'tbl-name', type: 'button', title: `Run SELECT * on ${t.name}`,
          onclick: () => { editor().value = `SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 50;`; updateGutter(); run(); }
        }, h('span', {}, t.name), h('small', {}, `${t.rowCount} rows`)),
        h('div', { class: 'tbl-cols' }, t.columns.map((c) => h('span', { class: c.pk ? 'pk' : '', title: c.type }, c.name))),
        prev.values.length ? h('div', { class: 'tbl-preview' }, h('table', {},
          h('thead', {}, h('tr', {}, prev.columns.map((c) => h('th', {}, c)))),
          h('tbody', {}, prev.values.map((r) => h('tr', {}, r.map((v) => h('td', {}, v === null ? 'NULL' : String(v)))))))) : null);
    }));
  }

  function renderTemplates() {
    $('#template-list').replaceChildren(...GAP.sql.templatesFor(GAP.sql.getActiveDbKey()).map(([label, sql]) =>
      h('button', { class: 'chip', type: 'button', title: 'Put this template in the editor', onclick: () => { editor().value = sql; updateGutter(); editor().focus(); } }, label)));
  }

  function clearOutput(message = 'Results appear here after you run a query.') {
    last = null;
    setStatus('Ready', '');
    $('#meta-time').hidden = true;
    $('#meta-rows').hidden = true;
    $('#output-actions').hidden = true;
    $('#output').replaceChildren(h('div', { class: 'placeholder' }, h('p', {}, message)));
  }

  function switchDb(key, message) {
    GAP.sql.loadDatabase(key);
    renderTables();
    renderTemplates();
    clearOutput();
    if (message) toast(message, 'success');
  }

  function showEngineFailure(error) {
    $('#table-list').replaceChildren(h('div', { class: 'side-empty' }, 'Tables are unavailable.'));
    $('#output').replaceChildren(h('div', { class: 'sql-error', role: 'alert' },
      h('h3', {}, 'The SQL engine did not start'),
      h('pre', {}, error),
      h('p', {}, 'Reload the page. If it keeps happening, try another browser or ask your teacher to check that the school network allows this site.'),
      h('div', { class: 'result-actions' }, GAP.ui.btn('Try again', { cls: 'btn-secondary btn-sm', onclick: boot }))));
    setStatus('Unavailable', 'err');
  }

  async function boot() {
    const res = await GAP.sql.init();
    engineOk = res.ok;
    if (!res.ok) { showEngineFailure(res.error); return; }
    renderTables();
    renderTemplates();
    clearOutput();
  }

  // Used by My Zone, Quick Share and the Class Board to open SQL here.
  function load(sql, { run: runIt = true } = {}) {
    editor().value = sql;
    updateGutter();
    location.hash = '#/playground';
    if (runIt) setTimeout(run, 0);
  }

  function init() {
    const ed = editor();
    ed.addEventListener('input', updateGutter);
    ed.addEventListener('scroll', () => { $('#gutter').scrollTop = ed.scrollTop; });
    ed.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });
    $('#btn-run').addEventListener('click', run);
    $('#btn-format').addEventListener('click', () => {
      if (!sqlText().trim()) return;
      ed.value = GAP.sql.formatSql(sqlText());
      updateGutter();
      toast('Formatted.', 'success');
    });
    $('#btn-clear').addEventListener('click', () => { ed.value = ''; updateGutter(); clearOutput(); ed.focus(); });
    $('#db-select').addEventListener('change', (e) => {
      const label = e.target.options[e.target.selectedIndex].text;
      switchDb(e.target.value, `Switched to the ${label} database.`);
    });
    $('#btn-reset-db').addEventListener('click', () => switchDb($('#db-select').value, 'Database restored to its original data.'));
    $('#btn-copy-csv').addEventListener('click', () => last && copyWithToast(GAP.sql.resultsToCsv(last.columns, last.values), 'CSV'));
    $('#btn-download-csv').addEventListener('click', () => {
      if (!last) return;
      const url = URL.createObjectURL(new Blob([GAP.sql.resultsToCsv(last.columns, last.values)], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `query-results-${Date.now()}.csv` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('CSV downloaded.', 'success');
    });
    $('#btn-save-zone').addEventListener('click', () => {
      if (!sqlText().trim()) { toast('Write a query first, then save it.', 'error'); ed.focus(); return; }
      if (!GAP.api.isSignedIn()) { GAP.auth.require('#/playground', 'Log in to save queries to My Zone.'); return; }
      GAP.zone.openQueryDialog({ sql: sqlText() });
    });
    $('#btn-share-query').addEventListener('click', () => {
      if (!sqlText().trim()) { toast('Write a query first, then share it.', 'error'); ed.focus(); return; }
      GAP.share.prefill({ content: sqlText() });
      location.hash = '#/share';
    });
    updateGutter();
    boot();
  }

  return { init, load, run };
})();
