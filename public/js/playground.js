// playground.js - the SQL editor, results table and table browser.

window.GAP = window.GAP || {};

GAP.playground = (() => {
  const { $, h, icon, btn, toast, copyWithToast } = GAP.ui;
  const ROW_RENDER_LIMIT = 1000;
  let last = null; // last successful rows result, for CSV
  let lastFullResult = null; // full result object with allSets
  let engineOk = false;
  let cm = null; // CodeMirror instance
  let activeTableSearch = '';
  let isWrapped = false;
  let isExecuting = false;
  const expandedTables = new Set();
  const tableLimits = {}; // tableName -> limit number (default 10)

  const editor = () => $('#sql-editor');

  function sqlText() {
    return cm ? cm.getValue() : (editor() ? editor().value : '');
  }

  function setSqlText(val) {
    if (cm) {
      cm.setValue(val);
      refresh();
    } else if (editor()) {
      editor().value = val;
      updateGutter();
    }
  }

  function focusEditor() {
    if (cm) cm.focus();
    else if (editor()) editor().focus();
  }

  function insertAtCursor(text) {
    if (cm) {
      cm.replaceSelection(text);
      cm.focus();
    } else {
      const ed = editor();
      if (!ed) return;
      const start = ed.selectionStart, end = ed.selectionEnd;
      ed.value = ed.value.substring(0, start) + text + ed.value.substring(end);
      ed.selectionStart = ed.selectionEnd = start + text.length;
      ed.focus();
      updateGutter();
    }
  }

  function updateGutter() {
    if (cm) return; // CodeMirror manages its own line numbers
    const ed = editor();
    if (!ed) return;
    const lines = ed.value.split('\n').length;
    const g = $('#gutter');
    if (g) {
      g.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
      g.scrollTop = ed.scrollTop;
    }
  }

  function setStatus(text, kind) {
    const s = $('#status');
    if (s) {
      s.textContent = text;
      s.className = `status${kind ? ` ${kind}` : ''}`;
    }
  }

  function setMeta(res) {
    const t = $('#meta-time'), r = $('#meta-rows');
    if (t) {
      t.hidden = res.execTimeMs === undefined;
      t.textContent = `${res.execTimeMs} ms`;
    }
    if (r) {
      r.hidden = res.kind !== 'rows';
      if (res.kind === 'rows') r.textContent = `${res.rowCount.toLocaleString()} row${res.rowCount === 1 ? '' : 's'}`;
    }
    const actions = $('#output-actions');
    if (actions) actions.hidden = res.kind !== 'rows';
  }

  function renderTable(res, activeSetIdx = 0) {
    lastFullResult = res;
    const targetSet = (res.allSets && res.allSets[activeSetIdx]) ? res.allSets[activeSetIdx] : res;
    last = targetSet;

    // Update row count in meta for the currently selected result set
    const rMeta = $('#meta-rows');
    if (rMeta) rMeta.textContent = `${targetSet.rowCount.toLocaleString()} row${targetSet.rowCount === 1 ? '' : 's'}`;

    const shown = targetSet.values.slice(0, ROW_RENDER_LIMIT);
    const head = h('tr', {},
      h('th', { class: 'rownum', scope: 'col', title: 'Row number' }, '#'),
      targetSet.columns.map((c) => h('th', { scope: 'col', title: String(c) }, String(c)))
    );

    const body = shown.map((row, i) => h('tr', {},
      h('td', { class: 'rownum' }, i + 1),
      row.map((v) => {
        if (v === null || v === undefined) {
          return h('td', { class: 'null', title: 'NULL' }, 'NULL');
        }
        const strVal = String(v);
        const isNum = typeof v === 'number' || (!isNaN(v) && !isNaN(parseFloat(v)) && !strVal.startsWith('0x'));
        return h('td', { class: isNum ? 'num' : '', title: strVal }, strVal);
      })
    ));

    const out = $('#output');
    const tableWrap = h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Query results' },
      h('table', { class: 'data' }, h('thead', {}, head), h('tbody', {}, body))
    );

    const elementsToAppend = [];

    // Result Set Tabs if query returned multiple result sets
    if (res.allSets && res.allSets.length > 1) {
      const tabs = h('div', { class: 'result-set-tabs', role: 'tablist', 'aria-label': 'Query Result Sets' },
        res.allSets.map((s, idx) => h('button', {
          class: `tab-result-set${idx === activeSetIdx ? ' active' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(idx === activeSetIdx),
          onclick: () => renderTable(res, idx)
        }, `Result ${idx + 1} (${s.rowCount.toLocaleString()} ${s.rowCount === 1 ? 'row' : 'rows'})`))
      );
      elementsToAppend.push(tabs);
    }

    elementsToAppend.push(tableWrap);

    const notes = [];
    if (targetSet.values.length > ROW_RENDER_LIMIT) {
      notes.push(`Showing the first ${ROW_RENDER_LIMIT.toLocaleString()} of ${targetSet.rowCount.toLocaleString()} rows. CSV export includes all rows.`);
    }
    if (res.resultSets > 1 && (!res.allSets || res.allSets.length <= 1)) {
      notes.push(`Your script produced ${res.resultSets} result sets. Showing the last one.`);
    }
    if (notes.length) elementsToAppend.push(h('p', { class: 'note-line' }, notes.join(' ')));

    out.replaceChildren(...elementsToAppend);
  }

  function run() {
    if (isExecuting) return;
    if (!engineOk) { toast('The SQL engine is not ready.', 'error'); return; }
    const code = sqlText();
    if (!code.trim()) { toast('Write a query first.', 'error'); focusEditor(); return; }

    const runBtn = $('#btn-run');
    isExecuting = true;
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.classList.add('loading');
    }
    setStatus('Running', '');

    // Allow UI to update before synchronous WASM execution
    setTimeout(() => {
      try {
        const res = GAP.sql.execute(code);
        last = null;
        lastFullResult = null;

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
          renderTable(res, (res.allSets ? res.allSets.length - 1 : 0));
        } else {
          $('#output').replaceChildren(h('div', { class: 'done' }, h('div', {}, h('strong', {}, res.kind === 'empty' ? 'No rows' : 'Done'), res.message)));
        }

        renderTables();
        updateCmSchema();
      } finally {
        isExecuting = false;
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.classList.remove('loading');
        }
      }
    }, 10);
  }

  function updateCmSchema() {
    if (cm && GAP.sql.getSchema) {
      cm.setOption('hintOptions', { tables: GAP.sql.getSchema(), completeSingle: false });
    }
  }

  function renderTables() {
    const allTables = GAP.sql.inspectTables();
    const countEl = $('#table-count');
    if (countEl) countEl.textContent = allTables.length;
    const list = $('#table-list');
    if (!list) return;

    if (!allTables.length) {
      list.replaceChildren(h('div', { class: 'side-empty' }, 'No tables yet. Create one with CREATE TABLE, then it appears here.'));
      return;
    }

    const q = activeTableSearch.trim().toLowerCase();
    const tables = q
      ? allTables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q) || (c.type && c.type.toLowerCase().includes(q))))
      : allTables;

    if (!tables.length) {
      list.replaceChildren(h('div', { class: 'side-empty' }, `No tables or columns match "${activeTableSearch}".`));
      return;
    }

    list.replaceChildren(...tables.map((t) => {
      const isExpanded = expandedTables.has(t.name);
      const limit = tableLimits[t.name] || 10;
      const preview = isExpanded ? GAP.sql.previewRows(t.name, limit) : null;

      // Table Header Row
      const toggleBtn = h('button', {
        class: 'tbl-header-btn', type: 'button',
        'aria-expanded': String(isExpanded),
        title: isExpanded ? 'Collapse preview' : 'Expand live records preview',
        onclick: () => {
          if (expandedTables.has(t.name)) expandedTables.delete(t.name);
          else expandedTables.add(t.name);
          renderTables();
        }
      },
        h('span', { class: `tbl-chevron${isExpanded ? ' open' : ''}` }, icon('chevron-right')),
        h('span', { class: 'tbl-name-text' }, t.name),
        h('span', { class: 'pill tbl-row-badge' }, `${t.rowCount} ${t.rowCount === 1 ? 'row' : 'rows'}`));

      const queryBtn = h('button', {
        class: 'btn btn-ghost btn-xs', type: 'button',
        title: `Run SELECT * FROM "${t.name}"`,
        onclick: (e) => {
          e.stopPropagation();
          setSqlText(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 50;`);
          run();
        }
      }, icon('play'), h('span', {}, 'Query'));

      const insertBtn = h('button', {
        class: 'btn btn-ghost btn-xs', type: 'button',
        title: `Insert table name "${t.name}" into query`,
        onclick: (e) => {
          e.stopPropagation();
          insertAtCursor(`"${t.name.replace(/"/g, '""')}"`);
        }
      }, h('span', {}, 'Insert'));

      const headerBar = h('div', { class: 'tbl-card-head' },
        toggleBtn,
        h('div', { class: 'tbl-card-actions' }, queryBtn, insertBtn));

      // Columns Section
      const colsList = h('div', { class: 'tbl-cols-wrap' },
        t.columns.map((c) => {
          const badges = [];
          if (c.pk) badges.push(h('span', { class: 'col-badge pk', title: 'Primary Key' }, 'PK'));
          if (c.fk) badges.push(h('span', { class: 'col-badge fk', title: `Foreign Key -> ${c.fk.targetTable}.${c.fk.targetColumn}` }, 'FK'));
          if (c.notnull && !c.pk) badges.push(h('span', { class: 'col-badge nn', title: 'Not Null' }, 'NN'));

          return h('div', {
            class: 'tbl-col-item',
            title: `Click to insert column "${c.name}"`,
            onclick: () => insertAtCursor(`"${c.name.replace(/"/g, '""')}"`)
          },
            h('span', { class: 'col-name' }, c.name),
            h('span', { class: 'col-type' }, c.type),
            badges.length ? h('span', { class: 'col-badges' }, ...badges) : null
          );
        })
      );

      // Expandable Live Records Drawer
      let drawer = null;
      if (isExpanded) {
        const pCols = preview.columns || [];
        const pRows = preview.values || [];

        const limitPills = [5, 10, 25, 50].map((n) => h('button', {
          class: `btn-limit-pill${limit === n ? ' active' : ''}`,
          type: 'button',
          onclick: (e) => {
            e.stopPropagation();
            tableLimits[t.name] = n;
            renderTables();
          }
        }, String(n)));

        const drawerControls = h('div', { class: 'tbl-preview-controls' },
          h('span', { class: 'tbl-preview-label' }, 'Show top:'),
          ...limitPills
        );

        let tableContent;
        if (!pRows.length) {
          tableContent = h('div', { class: 'tbl-preview-empty' }, 'No records in this table.');
        } else {
          const thead = h('thead', {}, h('tr', {},
            h('th', { class: 'rownum' }, '#'),
            pCols.map((c) => h('th', {}, c))));
          const tbody = h('tbody', {},
            pRows.map((row, idx) => h('tr', {},
              h('td', { class: 'rownum' }, idx + 1),
              row.map((val) => (val === null ? h('td', { class: 'null' }, 'NULL') : h('td', {}, String(val))))
            )));
          tableContent = h('div', { class: 'tbl-preview-table-wrap' },
            h('table', { class: 'tbl-preview-data' }, thead, tbody));
        }

        drawer = h('div', { class: 'tbl-preview-drawer' },
          drawerControls,
          tableContent);
      }

      return h('div', { class: `tbl-card${isExpanded ? ' expanded' : ''}` },
        headerBar,
        colsList,
        drawer);
    }));
  }

  function renderTemplates() {
    const list = $('#template-list');
    if (!list) return;
    const items = GAP.sql.templatesFor(GAP.sql.getActiveDbKey());
    list.replaceChildren(...items.map(([label, sql]) => h('button', {
      class: 'chip', type: 'button',
      onclick: () => {
        setSqlText(sql);
        focusEditor();
        run();
      }
    }, label)));
  }

  function clearOutput() {
    last = null;
    lastFullResult = null;
    $('#output').replaceChildren(h('div', { class: 'placeholder' }, h('p', {}, 'Results appear here after you run a query.')));
    setStatus('Ready', '');
    setMeta({});
  }

  function switchDb(key, message) {
    GAP.sql.loadDatabase(key);
    expandedTables.clear();
    renderTables();
    renderTemplates();
    clearOutput();
    updateCmSchema();
    refresh();
    toast(message, 'success');
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
    updateCmSchema();
    refresh();
  }

  // Used by My Zone, Quick Share and the Class Board to open SQL here.
  function load(sql, { run: runIt = true } = {}) {
    setSqlText(sql);
    location.hash = '#/playground';
    refresh();
    if (runIt) setTimeout(run, 60);
  }

  function refresh() {
    if (cm) {
      requestAnimationFrame(() => {
        if (cm) {
          cm.refresh();
          setTimeout(() => { if (cm) cm.refresh(); }, 50);
        }
      });
    }
  }

  function initEditor() {
    const ed = editor();
    if (!ed) return;

    if (window.CodeMirror) {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      cm = CodeMirror.fromTextArea(ed, {
        mode: 'text/x-sql',
        theme: isDark ? 'vscode-dark' : 'vscode-light',
        lineNumbers: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        styleActiveLine: true,
        indentUnit: 2,
        tabSize: 2,
        indentWithTabs: false,
        lineWrapping: false, // Default to horizontal scrolling with pinned gutter so code is never cut off
        fixedGutter: true,
        coverGutterNextToScrollbar: true,
        scrollbarStyle: 'native',
        extraKeys: {
          'Ctrl-Enter': () => run(),
          'Cmd-Enter': () => run(),
          'Ctrl-Space': 'autocomplete',
          'Tab': (cmInstance) => {
            if (cmInstance.somethingSelected()) {
              cmInstance.indentSelection('add');
            } else {
              cmInstance.replaceSelection('  ', 'end', '+input');
            }
          },
          'Shift-Tab': (cmInstance) => cmInstance.indentSelection('subtract')
        },
        hintOptions: {
          tables: GAP.sql.getSchema ? GAP.sql.getSchema() : {},
          completeSingle: false
        }
      });

      // Multi-cursor editing using Alt + Click:
      cm.on('mousedown', (cmInstance, e) => {
        if (e.altKey && e.button === 0) {
          e.preventDefault();
          const pos = cmInstance.coordsChar({ left: e.clientX, top: e.clientY });
          cmInstance.addSelection(pos, pos);
        }
      });

      // SQL autocomplete trigger on typing letters or period
      cm.on('inputRead', (cmInstance, change) => {
        if (change.origin !== '+input') return;
        const ch = change.text[0];
        if (/[a-zA-Z0-9_.]/.test(ch)) {
          if (!cmInstance.state.completionActive && typeof CodeMirror.commands.autocomplete === 'function') {
            CodeMirror.commands.autocomplete(cmInstance, null, {
              completeSingle: false,
              tables: GAP.sql.getSchema ? GAP.sql.getSchema() : {}
            });
          }
        }
      });

      // Update theme when document data-theme changes
      const observer = new MutationObserver(() => {
        const dark = document.documentElement.getAttribute('data-theme') !== 'light';
        cm.setOption('theme', dark ? 'vscode-dark' : 'vscode-light');
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      // ResizeObserver to automatically refresh CodeMirror when container dimensions change
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          if (cm && cm.getWrapperElement().offsetParent !== null) {
            cm.refresh();
          }
        });
        const wrap = $('#editor-wrap') || ed.parentElement;
        if (wrap) ro.observe(wrap);
      }

      // Font loading listener to re-align glyph metrics once web fonts arrive
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          if (cm) cm.refresh();
        });
      }

      // Window resize listener
      window.addEventListener('resize', () => {
        if (cm && cm.getWrapperElement().offsetParent !== null) {
          cm.refresh();
        }
      });
    } else {
      // Fallback to basic textarea
      ed.addEventListener('input', updateGutter);
      ed.addEventListener('scroll', () => { $('#gutter').scrollTop = ed.scrollTop; });
      ed.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      });
      updateGutter();
    }
  }

  function init() {
    initEditor();

    $('#btn-run').addEventListener('click', run);
    $('#btn-format').addEventListener('click', () => {
      const current = sqlText();
      if (!current.trim()) return;
      setSqlText(GAP.sql.formatSql(current));
      toast('Formatted.', 'success');
    });
    $('#btn-clear').addEventListener('click', () => {
      setSqlText('');
      clearOutput();
      focusEditor();
    });

    const btnResetDb = $('#btn-reset-db');
    if (btnResetDb) {
      btnResetDb.addEventListener('click', () => {
        const key = GAP.sql.getActiveDbKey() || 'university';
        switchDb(key, 'Database restored to its original data.');
      });
    }
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
      const current = sqlText();
      if (!current.trim()) { toast('Write a query first, then save it.', 'error'); focusEditor(); return; }
      if (!GAP.api.isSignedIn()) { GAP.auth.require('#/playground', 'Log in to save queries to My Zone.'); return; }
      GAP.zone.openQueryDialog({ sql: current });
    });
    $('#btn-share-query').addEventListener('click', () => {
      const current = sqlText();
      if (!current.trim()) { toast('Write a query first, then share it.', 'error'); focusEditor(); return; }
      GAP.share.prefill({ content: current });
      location.hash = '#/share';
    });

    // Table Search filter
    const searchInput = $('#table-search');
    if (searchInput) {
      searchInput.value = '';          // clear browser autofill
      activeTableSearch = '';
      searchInput.addEventListener('input', (e) => {
        activeTableSearch = e.target.value;
        renderTables();
      });
    }

    // Refresh tables button
    const btnRefresh = $('#btn-refresh-tables');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        renderTables();
        updateCmSchema();
        toast('Tables refreshed from database.', 'success');
      });
    }

    boot();
  }

  return { init, load, run, refresh, getSql: sqlText, setSql: setSqlText };
})();
