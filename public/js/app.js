// app.js - Main Application Controller & UI Logic

const App = (() => {
  let activeTab = 'runner';
  let vaultData = { queries: [], notes: [] };
  let labTimerInterval = null;
  let lastActivityTime = Date.now();
  const LAB_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes auto-lock

  // DOM Elements cache
  const elements = {};

  function cacheDom() {
    elements.tabs = document.querySelectorAll('.nav-tab');
    elements.views = document.querySelectorAll('.tab-view');
    elements.sqlEditor = document.getElementById('sql-editor');
    elements.editorGutter = document.getElementById('editor-gutter');
    elements.btnRunSql = document.getElementById('btn-run-sql');
    elements.btnFormatSql = document.getElementById('btn-format-sql');
    elements.btnClearSql = document.getElementById('btn-clear-sql');
    elements.btnBeamQuery = document.getElementById('btn-beam-query');
    elements.btnSaveQueryToVault = document.getElementById('btn-save-query-to-vault');
    elements.sampleDbSelect = document.getElementById('sample-db-select');
    elements.btnResetDb = document.getElementById('btn-reset-db');
    elements.btnExportCurrentSchema = document.getElementById('btn-export-current-schema');
    elements.tablesList = document.getElementById('tables-list');
    elements.tablesCount = document.getElementById('tables-count');
    elements.resultsContainer = document.getElementById('results-container');
    elements.queryStatusBadge = document.getElementById('query-status-badge');
    elements.queryExecTime = document.getElementById('query-exec-time');
    elements.queryRowCount = document.getElementById('query-row-count');
    elements.resultsActions = document.getElementById('results-actions');
    elements.btnCopyResultsCsv = document.getElementById('btn-copy-results-csv');
    elements.btnDownloadResultsCsv = document.getElementById('btn-download-results-csv');

    // Vault DOM
    elements.vaultLockedState = document.getElementById('vault-locked-state');
    elements.vaultUnlockedState = document.getElementById('vault-unlocked-state');
    elements.vaultAuthStatus = document.getElementById('vault-auth-status');
    elements.vaultCountBadge = document.getElementById('vault-count-badge');
    elements.vaultItemsGrid = document.getElementById('vault-items-grid');
    elements.vaultSearchInput = document.getElementById('vault-search-input');
    elements.vaultTypeFilter = document.getElementById('vault-type-filter');
    elements.vaultSubjectFilter = document.getElementById('vault-subject-filter');
    elements.vaultStudentName = document.getElementById('vault-student-name');
    elements.vaultStudentId = document.getElementById('vault-student-id');
    elements.vaultAvatar = document.getElementById('vault-avatar');
    elements.btnPromptUnlock = document.getElementById('btn-prompt-unlock');
    elements.btnLockVault = document.getElementById('btn-lock-vault');
    elements.btnExportDropdown = document.getElementById('btn-export-dropdown');
    elements.exportDropdownMenu = document.getElementById('export-dropdown-menu');
    elements.btnExportSql = document.getElementById('btn-export-sql');
    elements.btnExportJson = document.getElementById('btn-export-json');

    // Modals
    elements.modalUnlock = document.getElementById('modal-unlock-vault');
    elements.formAuthVault = document.getElementById('form-auth-vault');
    elements.modalEditQuery = document.getElementById('modal-edit-query');
    elements.formSaveQuery = document.getElementById('form-save-query');
    elements.modalEditNote = document.getElementById('modal-edit-note');
    elements.formSaveNote = document.getElementById('form-save-note');
    elements.modalShareCommunity = document.getElementById('modal-share-community');
    elements.formShareCommunity = document.getElementById('form-share-community');

    // Beam DOM
    elements.formCreateBeam = document.getElementById('form-create-beam');
    elements.formClaimBeam = document.getElementById('form-claim-beam');
    elements.beamCodeInput = document.getElementById('beam-code-input');
    elements.claimedBeamResult = document.getElementById('claimed-beam-result');
    elements.generatedBeamModalCard = document.getElementById('generated-beam-modal-card');

    // Theme & Toast
    elements.themeToggle = document.getElementById('theme-toggle');
    elements.toastContainer = document.getElementById('toast-container');
    elements.labTimerDisplay = document.getElementById('lab-timer-display');
  }

  // Toast notification system
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  // Switch tabs
  function switchTab(tabId) {
    activeTab = tabId;
    elements.tabs.forEach(tab => {
      if (tab.dataset.tab === tabId) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    elements.views.forEach(view => {
      if (view.id === `view-${tabId}`) view.classList.add('active');
      else view.classList.remove('active');
    });

    if (tabId === 'vault' && ApiClient.isAuthenticated()) {
      loadVaultData();
    } else if (tabId === 'community') {
      loadCommunityData();
    } else if (tabId === 'cheatsheet') {
      CheatsheetModule.init('joins');
    }
  }

  // Update line gutter
  function updateEditorGutter() {
    if (!elements.sqlEditor || !elements.editorGutter) return;
    const lines = elements.sqlEditor.value.split('\n').length;
    let gutterHtml = '';
    for (let i = 1; i <= Math.max(lines, 1); i++) {
      gutterHtml += `${i}<br>`;
    }
    elements.editorGutter.innerHTML = gutterHtml;
  }

  // Render Table Previews in Right Panel
  function refreshSchemaSidebar() {
    const tables = SqlEngine.inspectTables();
    elements.tablesCount.textContent = tables.length;

    if (!tables.length) {
      elements.tablesList.innerHTML = '<div class="tree-placeholder">No tables found.</div>';
      return;
    }

    elements.tablesList.innerHTML = tables.map(t => {
      // Build header row from column names
      const colHeaders = t.columns.map(c =>
        `<th>${escapeHtml(c.name)}</th>`
      ).join('');

      // Fetch up to 3 preview rows for this table
      let previewRows = '';
      try {
        const previewRes = SqlEngine.execute(`SELECT * FROM "${t.name}" LIMIT 3;`);
        if (previewRes.success && previewRes.isSelect && previewRes.values && previewRes.values.length > 0) {
          previewRows = previewRes.values.map(row =>
            `<tr>${row.map(v =>
              `<td>${v === null || v === undefined ? '<span style="color:var(--text-dim);font-style:italic;">null</span>' : escapeHtml(String(v))}</td>`
            ).join('')}</tr>`
          ).join('');
        } else {
          previewRows = `<tr><td colspan="${t.columns.length}" class="table-preview-empty">empty</td></tr>`;
        }
      } catch(e) {
        previewRows = `<tr><td colspan="${t.columns.length}" class="table-preview-empty">—</td></tr>`;
      }

      return `
        <div class="table-preview-block">
          <div class="table-preview-name" onclick="App.runSelectTable('${t.name}')">${escapeHtml(t.name)}</div>
          <div class="table-preview-scroll">
            <table class="table-preview-table">
              <thead><tr>${colHeaders}</tr></thead>
              <tbody>${previewRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }

  // Execute SQL in Editor
  let lastExecutedResult = null;
  function executeEditorSql() {
    const code = elements.sqlEditor.value.trim();
    if (!code) {
      showToast('Please type a SQL query to execute.', 'error');
      return;
    }

    elements.queryStatusBadge.textContent = 'Executing...';
    elements.queryStatusBadge.className = 'status-indicator';

    setTimeout(() => {
      const res = SqlEngine.execute(code);
      lastExecutedResult = res;

      if (!res.success) {
        elements.queryStatusBadge.textContent = 'Error';
        elements.queryStatusBadge.className = 'status-indicator error';
        elements.queryExecTime.style.display = 'inline-block';
        elements.queryExecTime.textContent = `⏱ ${res.execTimeMs || 0}ms`;
        elements.queryRowCount.style.display = 'none';
        elements.resultsActions.style.display = 'none';

        elements.resultsContainer.innerHTML = `
          <div class="error-banner">
            <h5>SQL Execution Error</h5>
            <pre>${escapeHtml(res.error)}</pre>
          </div>
        `;
        showToast('Query failed to execute. Check error message below.', 'error');
        return;
      }

      elements.queryStatusBadge.textContent = 'Success';
      elements.queryStatusBadge.className = 'status-indicator success';
      elements.queryExecTime.style.display = 'inline-block';
      elements.queryExecTime.textContent = `⏱ ${res.execTimeMs}ms`;

      if (res.isSelect) {
        elements.queryRowCount.style.display = 'inline-block';
        elements.queryRowCount.textContent = `📊 ${res.rowCount} row${res.rowCount === 1 ? '' : 's'}`;
        elements.resultsActions.style.display = 'flex';

        // Render HTML Table
        renderResultsTable(res.columns, res.values);
        showToast(`Query executed in ${res.execTimeMs}ms! (${res.rowCount} rows)`, 'success');
      } else {
        elements.queryRowCount.style.display = 'none';
        elements.resultsActions.style.display = 'none';

        elements.resultsContainer.innerHTML = `
          <div class="results-welcome-state">
            <div class="welcome-icon">✅</div>
            <h4>Command Completed</h4>
            <p>${escapeHtml(res.message || 'Rows modified.')}</p>
          </div>
        `;
        showToast('SQL command executed successfully!', 'success');
        refreshSchemaSidebar();
      }
    }, 10);
  }

  // Render HTML data table with sticky headers
  function renderResultsTable(columns, values) {
    if (!columns || !columns.length) {
      elements.resultsContainer.innerHTML = '<div class="results-welcome-state"><p>No columns returned.</p></div>';
      return;
    }

    let html = `
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px; text-align:center;">#</th>
              ${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    if (!values.length) {
      html += `<tr><td colspan="${columns.length + 1}" style="text-align:center; padding:2rem; color:var(--text-muted);">Query returned 0 rows.</td></tr>`;
    } else {
      values.forEach((row, idx) => {
        html += `<tr><td style="text-align:center; color:var(--text-muted); font-size:0.75rem;">${idx + 1}</td>`;
        row.forEach(val => {
          if (val === null || val === undefined) {
            html += `<td class="null-cell">NULL</td>`;
          } else {
            html += `<td>${escapeHtml(String(val))}</td>`;
          }
        });
        html += `</tr>`;
      });
    }

    html += `</tbody></table></div>`;
    elements.resultsContainer.innerHTML = html;
  }

  // Helper: Click table in sidebar to run SELECT *
  function runSelectTable(tableName) {
    elements.sqlEditor.value = `SELECT * FROM "${tableName}" LIMIT 50;`;
    updateEditorGutter();
    executeEditorSql();
  }

  // Load SQL query directly to editor
  function loadSqlToRunner(sqlText) {
    switchTab('runner');
    elements.sqlEditor.value = sqlText;
    updateEditorGutter();
    executeEditorSql();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ========================================================
  // VAULT CONTROLLER
  // ========================================================
  function updateVaultUI() {
    const isAuthed = ApiClient.isAuthenticated();
    const meta = ApiClient.getStudentMeta();

    if (isAuthed && meta) {
      elements.vaultLockedState.style.display = 'none';
      elements.vaultUnlockedState.style.display = 'block';

      elements.vaultStudentName.textContent = meta.studentName || meta.studentId;
      elements.vaultStudentId.textContent = meta.studentId;
      elements.vaultAvatar.textContent = (meta.studentName || meta.studentId).charAt(0).toUpperCase();

      elements.vaultAuthStatus.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span class="badge badge-accent">🎓 ${escapeHtml(meta.studentId)}</span>
          <button class="btn btn-xs btn-outline" id="btn-header-lock" title="Lock vault">🔒 Lock</button>
        </div>
      `;
      document.getElementById('btn-header-lock').onclick = lockVault;

      loadVaultData();
    } else {
      elements.vaultLockedState.style.display = 'block';
      elements.vaultUnlockedState.style.display = 'none';
      elements.vaultCountBadge.style.display = 'none';
      elements.vaultAuthStatus.innerHTML = `
        <button class="btn btn-primary btn-sm" id="btn-open-unlock-modal">
          <span>🔑 Unlock Vault</span>
        </button>
      `;
      document.getElementById('btn-open-unlock-modal').onclick = () => openModal('unlock');
    }
  }

  async function loadVaultData() {
    try {
      const res = await ApiClient.getVault();
      vaultData = {
        queries: res.queries || [],
        notes: res.notes || []
      };

      const total = vaultData.queries.length + vaultData.notes.length;
      elements.vaultCountBadge.textContent = total;
      elements.vaultCountBadge.style.display = total > 0 ? 'inline-block' : 'none';

      populateSubjectFilter();
      renderVaultGrid();
    } catch (err) {
      if (err.message && err.message.includes('Authentication')) {
        lockVault();
      }
    }
  }

  function populateSubjectFilter() {
    const subjects = new Set();
    vaultData.queries.forEach(q => q.subject && subjects.add(q.subject));
    vaultData.notes.forEach(n => n.subject && subjects.add(n.subject));

    const currentVal = elements.vaultSubjectFilter.value;
    elements.vaultSubjectFilter.innerHTML = '<option value="all">All Subjects</option>';
    subjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub;
      opt.textContent = sub;
      elements.vaultSubjectFilter.appendChild(opt);
    });
    if (subjects.has(currentVal)) elements.vaultSubjectFilter.value = currentVal;
  }

  function renderVaultGrid() {
    const searchTerm = (elements.vaultSearchInput.value || '').toLowerCase();
    const typeFilter = elements.vaultTypeFilter.value;
    const subjectFilter = elements.vaultSubjectFilter.value;

    let items = [];

    if (typeFilter === 'all' || typeFilter === 'queries') {
      vaultData.queries.forEach(q => items.push({ ...q, itemType: 'sql' }));
    }
    if (typeFilter === 'all' || typeFilter === 'notes') {
      vaultData.notes.forEach(n => items.push({ ...n, itemType: 'note' }));
    }

    if (subjectFilter !== 'all') {
      items = items.filter(i => i.subject === subjectFilter);
    }

    if (searchTerm) {
      items = items.filter(i => 
        (i.title && i.title.toLowerCase().includes(searchTerm)) ||
        (i.subject && i.subject.toLowerCase().includes(searchTerm)) ||
        (i.sql && i.sql.toLowerCase().includes(searchTerm)) ||
        (i.content && i.content.toLowerCase().includes(searchTerm)) ||
        (i.notes && i.notes.toLowerCase().includes(searchTerm)) ||
        (i.tags && i.tags.some(t => t.toLowerCase().includes(searchTerm)))
      );
    }

    if (!items.length) {
      elements.vaultItemsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:3rem; background:var(--bg-card); border-radius:var(--radius-lg); border:1px solid var(--border-subtle);">
          <div style="font-size:2rem; margin-bottom:0.5rem;">📭</div>
          <h4 style="margin-bottom:0.3rem;">No Items Found</h4>
          <p style="color:var(--text-muted); font-size:0.85rem;">Save your first SQL query or lab note to keep it synced between school and home.</p>
        </div>
      `;
      return;
    }

    elements.vaultItemsGrid.innerHTML = items.map(item => {
      const isSql = item.itemType === 'sql';
      const dateStr = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : 'Recent';

      return `
        <div class="vault-card">
          <div class="card-top-row">
            <span class="card-type-tag ${isSql ? 'sql' : 'note'}">${isSql ? '⚡ SQL Query' : '📝 Note'}</span>
            <span class="badge badge-subtle">${escapeHtml(item.subject || 'General')}</span>
          </div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          
          ${isSql ? `
            <div class="card-preview-box"><code>${escapeHtml(item.sql)}</code></div>
            ${item.notes ? `<div class="card-notes-text">💡 ${escapeHtml(item.notes)}</div>` : ''}
          ` : `
            <div class="card-preview-box" style="white-space:pre-wrap;">${escapeHtml(item.content)}</div>
          `}

          <div class="card-tags-row">
            ${(item.tags || []).map(t => `<span class="tag-chip" style="font-size:0.68rem; padding:0.15rem 0.45rem;">#${escapeHtml(t)}</span>`).join('')}
          </div>

          <div class="card-footer">
            <span class="card-date">Updated ${dateStr}</span>
            <div class="card-actions">
              ${isSql ? `
                <button class="btn btn-xs btn-primary" onclick="App.runVaultQuery('${item.id}')" title="Run in SQL Sandbox">⚡ Run</button>
                <button class="btn btn-xs btn-ghost" onclick="App.openEditQuery('${item.id}')" title="Edit">✏️</button>
                <button class="btn btn-xs btn-ghost" data-delete-query="${item.id}" onclick="App.deleteQuery('${item.id}')" title="Delete — click twice to confirm">🗑</button>
              ` : `
                <button class="btn btn-xs btn-ghost" onclick="App.openEditNote('${item.id}')" title="Edit">✏️</button>
                <button class="btn btn-xs btn-ghost" data-delete-note="${item.id}" onclick="App.deleteNote('${item.id}')" title="Delete — click twice to confirm">🗑</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function runVaultQuery(id) {
    const q = vaultData.queries.find(item => item.id === id);
    if (!q) return;
    loadSqlToRunner(q.sql);
    showToast(`Loaded: "${q.title}"`, 'info');
  }

  function beamVaultItem(id, type) {
    let title = '', content = '', subject = '', tags = [];
    if (type === 'sql') {
      const q = vaultData.queries.find(item => item.id === id);
      if (!q) return;
      title = q.title;
      content = q.sql;
      subject = q.subject;
      tags = q.tags;
    } else {
      const n = vaultData.notes.find(item => item.id === id);
      if (!n) return;
      title = n.title;
      content = n.content;
      subject = n.subject;
      tags = n.tags;
    }

    switchTab('beam');
    document.getElementById('beam-title-input').value = title;
    document.getElementById('beam-subject-input').value = subject || 'Lab';
    document.getElementById('beam-content-input').value = content;
    showToast('Item transferred to Quick Beam form. Click "Generate Code" to beam!', 'info');
  }

  async function deleteQuery(id) {
    const btn = document.querySelector(`[data-delete-query="${id}"]`);
    if (!btn) {
      if (!confirm('Delete this SQL query from your vault?')) return;
    } else {
      if (!btn.dataset.confirmed) {
        btn.dataset.confirmed = '1';
        btn.textContent = 'Confirm?';
        btn.classList.add('btn-danger');
        btn.classList.remove('btn-ghost');
        setTimeout(() => {
          btn.dataset.confirmed = '';
          btn.textContent = '\u{1F5D1}';
          btn.classList.remove('btn-danger');
          btn.classList.add('btn-ghost');
        }, 2500);
        return;
      }
    }
    try {
      await ApiClient.deleteQuery(id);
      showToast('Query deleted.', 'success');
      loadVaultData();
    } catch(err) {
      showToast(err.message || 'Failed to delete query.', 'error');
    }
  }

  async function deleteNote(id) {
    const btn = document.querySelector(`[data-delete-note="${id}"]`);
    if (!btn) {
      if (!confirm('Delete this note from your vault?')) return;
    } else {
      if (!btn.dataset.confirmed) {
        btn.dataset.confirmed = '1';
        btn.textContent = 'Confirm?';
        btn.classList.add('btn-danger');
        btn.classList.remove('btn-ghost');
        setTimeout(() => {
          btn.dataset.confirmed = '';
          btn.textContent = '\u{1F5D1}';
          btn.classList.remove('btn-danger');
          btn.classList.add('btn-ghost');
        }, 2500);
        return;
      }
    }
    try {
      await ApiClient.deleteNote(id);
      showToast('Note deleted.', 'success');
      loadVaultData();
    } catch(err) {
      showToast(err.message || 'Failed to delete note.', 'error');
    }
  }

  function lockVault() {
    ApiClient.clearSession();
    updateVaultUI();
    showToast('Vault locked and school session cleared.', 'info');
  }

  // ========================================================
  // COMMUNITY CONTROLLER
  // ========================================================
  async function loadCommunityData(filterTag = 'all') {
    try {
      const query = document.getElementById('community-search-input').value.trim();
      const params = {};
      if (query) params.query = query;
      if (filterTag && filterTag !== 'all') params.tag = filterTag;

      const res = await ApiClient.getCommunity(params);
      renderCommunityGrid(res.community || []);
    } catch(err) {
      showToast('Failed to load community queries.', 'error');
    }
  }

  function renderCommunityGrid(items) {
    const grid = document.getElementById('community-grid');
    if (!items.length) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding:2rem; color:var(--text-muted);">No shared queries found matching filter.</div>';
      return;
    }

    grid.innerHTML = items.map(c => `
      <div class="community-card">
        <div class="comm-author-row">
          <span>By <span class="comm-author">${escapeHtml(c.author || 'Student')}</span></span>
          <span class="badge badge-subtle">${escapeHtml(c.subject || 'DBMS')}</span>
        </div>
        <h3 class="comm-title">${escapeHtml(c.title)}</h3>
        ${c.description ? `<p class="comm-desc">${escapeHtml(c.description)}</p>` : ''}
        
        <div class="comm-code-block"><code>${escapeHtml(c.sql)}</code></div>

        <div class="card-tags-row">
          ${(c.tags || []).map(t => `<span class="tag-chip" style="font-size:0.68rem; padding:0.15rem 0.45rem;">#${escapeHtml(t)}</span>`).join('')}
        </div>

        <div class="comm-footer">
          <button class="upvote-btn" onclick="App.likeCommunity('${c.id}', this)">
            <span>👍</span> <span class="vote-count">${c.upvotes || 0}</span>
          </button>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn btn-xs btn-primary" onclick="App.loadSqlToRunner(\`${escapeJsString(c.sql)}\`)">⚡ Try in Runner</button>
            <button class="btn btn-xs btn-outline" onclick="App.forkToVault(\`${escapeJsString(c.title)}\`, \`${escapeJsString(c.sql)}\`, \`${escapeJsString(c.subject || '')}\`)">📥 Clone to Vault</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  async function likeCommunity(id, btnElement) {
    try {
      const res = await ApiClient.likeCommunity(id);
      const counter = btnElement.querySelector('.vote-count');
      if (counter) counter.textContent = res.upvotes;
      btnElement.style.color = 'var(--accent-primary)';
      showToast('Upvoted shared query!', 'success');
    } catch(err) {
      showToast(err.message || 'Could not upvote.', 'error');
    }
  }

  function forkToVault(title, sql, subject) {
    if (!ApiClient.isAuthenticated()) {
      showToast('Please unlock your Student Vault first to save queries!', 'error');
      openModal('unlock');
      return;
    }

    openModal('query', {
      title: `[Clone] ${title}`,
      sql,
      subject: subject || 'Shared Lab',
      tags: 'cloned, community'
    });
  }

  // ========================================================
  // QUICK BEAM CONTROLLER
  // ========================================================
  async function handleCreateBeam(e) {
    e.preventDefault();
    const title = document.getElementById('beam-title-input').value.trim();
    const subject = document.getElementById('beam-subject-input').value.trim();
    const expiry = document.getElementById('beam-expiry-select').value;
    const content = document.getElementById('beam-content-input').value.trim();

    if (!content) {
      showToast('Please enter query or note content to beam.', 'error');
      return;
    }

    try {
      const res = await ApiClient.createBeam({
        title,
        subject,
        expiryHours: expiry,
        content
      });

      document.getElementById('display-beam-code').textContent = res.code;
      const shareUrl = `${window.location.origin}${window.location.pathname}?beam=${res.code}`;
      document.getElementById('display-beam-url').value = shareUrl;
      elements.generatedBeamModalCard.style.display = 'block';

      showToast(`Transfer Code ${res.code} generated!`, 'success');
    } catch(err) {
      showToast(err.message || 'Failed to generate beam code.', 'error');
    }
  }

  async function handleClaimBeam(code) {
    if (!code) code = elements.beamCodeInput.value.trim();
    if (!code) {
      showToast('Please enter a 6-character transfer code.', 'error');
      return;
    }

    try {
      const res = await ApiClient.getBeam(code);
      const b = res.beam;

      document.getElementById('claimed-title').textContent = b.title;
      document.getElementById('claimed-subject').textContent = b.subject || 'Lab Snippet';
      document.getElementById('claimed-content').textContent = b.content;
      elements.claimedBeamResult.style.display = 'block';

      // Setup actions
      document.getElementById('btn-copy-claimed').onclick = () => {
        navigator.clipboard.writeText(b.content);
        showToast('Copied beamed text to clipboard!', 'success');
      };

      document.getElementById('btn-run-claimed-in-runner').onclick = () => {
        loadSqlToRunner(b.content);
      };

      document.getElementById('btn-save-claimed-to-vault').onclick = () => {
        if (!ApiClient.isAuthenticated()) {
          showToast('Please unlock your Student Vault to store this snippet permanently.', 'info');
          openModal('unlock');
        } else {
          openModal('query', {
            title: b.title,
            sql: b.content,
            subject: b.subject,
            tags: 'beamed'
          });
        }
      };

      showToast(`Beam ${code} successfully retrieved!`, 'success');
    } catch(err) {
      showToast(err.message || 'Could not find or claim beam code.', 'error');
    }
  }

  // ========================================================
  // MODALS MANAGEMENT
  // ========================================================
  function openModal(type, data = {}) {
    closeAllModals();

    if (type === 'unlock') {
      elements.modalUnlock.style.display = 'flex';
      document.getElementById('auth-student-id').focus();
    } else if (type === 'query') {
      elements.modalEditQuery.style.display = 'flex';
      document.getElementById('modal-query-id').value = data.id || '';
      document.getElementById('modal-query-title').value = data.title || '';
      document.getElementById('modal-query-subject').value = data.subject || 'Database Systems';
      document.getElementById('modal-query-tags').value = Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || '');
      document.getElementById('modal-query-sql').value = data.sql || (elements.sqlEditor.value || '');
      document.getElementById('modal-query-notes').value = data.notes || '';
      document.getElementById('modal-query-title-text').textContent = data.id ? 'Edit Saved Query' : 'Save Query to Vault';
    } else if (type === 'note') {
      elements.modalEditNote.style.display = 'flex';
      document.getElementById('modal-note-id').value = data.id || '';
      document.getElementById('modal-note-title').value = data.title || '';
      document.getElementById('modal-note-subject').value = data.subject || 'DBMS Lab';
      document.getElementById('modal-note-tags').value = Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || '');
      document.getElementById('modal-note-content').value = data.content || '';
      document.getElementById('modal-note-title-text').textContent = data.id ? 'Edit Study Note' : 'New Study Note';
    } else if (type === 'community') {
      elements.modalShareCommunity.style.display = 'flex';
      document.getElementById('share-sql').value = elements.sqlEditor.value || '';
    }
  }

  function closeAllModals() {
    elements.modalUnlock.style.display = 'none';
    elements.modalEditQuery.style.display = 'none';
    elements.modalEditNote.style.display = 'none';
    elements.modalShareCommunity.style.display = 'none';
  }

  // Open edit modal for existing item
  function openEditQuery(id) {
    const q = vaultData.queries.find(item => item.id === id);
    if (q) openModal('query', q);
  }

  function openEditNote(id) {
    const n = vaultData.notes.find(item => item.id === id);
    if (n) openModal('note', n);
  }

  // Lab Mode auto-lock timer
  function resetActivityTimer() {
    lastActivityTime = Date.now();
  }

  function startLabProtection() {
    clearInterval(labTimerInterval);
    labTimerInterval = setInterval(() => {
      const elapsed = Date.now() - lastActivityTime;
      const remainingSec = Math.max(0, Math.floor((LAB_TIMEOUT_MS - elapsed) / 1000));
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;

      if (elements.labTimerDisplay) {
        elements.labTimerDisplay.textContent = `Lab Safe: ${min}:${sec < 10 ? '0' : ''}${sec}`;
      }

      if (elapsed >= LAB_TIMEOUT_MS && ApiClient.isAuthenticated()) {
        lockVault();
        showToast('Vault auto-locked for school lab safety.', 'info');
      }
    }, 1000);
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeJsString(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\${/g, '\\${');
  }

  // Initialize theme
  function initTheme() {
    const saved = localStorage.getItem('edusql_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);

    elements.themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('edusql_theme', next);
      updateThemeIcons(next);
    });
  }

  function updateThemeIcons(theme) {
    const darkIcon = elements.themeToggle.querySelector('.theme-icon-dark');
    const lightIcon = elements.themeToggle.querySelector('.theme-icon-light');
    if (theme === 'light') {
      darkIcon.style.display = 'none';
      lightIcon.style.display = 'inline-block';
    } else {
      darkIcon.style.display = 'inline-block';
      lightIcon.style.display = 'none';
    }
  }

  // Bind All UI Events
  function bindEvents() {
    // Nav tabs
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Editor typing & gutter
    elements.sqlEditor.addEventListener('input', updateEditorGutter);
    elements.sqlEditor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeEditorSql();
      }
    });

    // Editor toolbar buttons
    elements.btnRunSql.addEventListener('click', executeEditorSql);
    elements.btnFormatSql.addEventListener('click', () => {
      const formatted = SqlEngine.formatSql(elements.sqlEditor.value);
      elements.sqlEditor.value = formatted;
      updateEditorGutter();
      showToast('SQL formatted & keywords capitalized!', 'info');
    });

    elements.btnClearSql.addEventListener('click', () => {
      elements.sqlEditor.value = '';
      updateEditorGutter();
      elements.resultsContainer.innerHTML = '<div class="results-welcome-state"><div class="welcome-icon">⚡</div><h4>Editor Cleared</h4><p>Write your query above or click a table on the left.</p></div>';
      elements.queryStatusBadge.textContent = 'Ready to run';
      elements.queryStatusBadge.className = 'status-indicator';
      elements.queryExecTime.style.display = 'none';
      elements.queryRowCount.style.display = 'none';
      elements.resultsActions.style.display = 'none';
    });

    elements.btnBeamQuery.addEventListener('click', () => {
      const sql = elements.sqlEditor.value.trim();
      if (!sql) {
        showToast('Please type a query to beam!', 'error');
        return;
      }
      switchTab('beam');
      document.getElementById('beam-content-input').value = sql;
      document.getElementById('beam-title-input').value = 'Lab Query';
    });

    elements.btnSaveQueryToVault.addEventListener('click', () => {
      if (!ApiClient.isAuthenticated()) {
        showToast('Please unlock your Student Vault first to save queries.', 'info');
        openModal('unlock');
        return;
      }
      openModal('query', {
        title: 'Lab Query',
        sql: elements.sqlEditor.value
      });
    });

    // Database Switcher
    elements.sampleDbSelect.addEventListener('change', (e) => {
      SqlEngine.loadDatabase(e.target.value);
      refreshSchemaSidebar();
      showToast(`Switched active database to: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });

    elements.btnResetDb.addEventListener('click', () => {
      SqlEngine.loadDatabase(elements.sampleDbSelect.value);
      refreshSchemaSidebar();
      showToast('Active database restored to initial state!', 'success');
    });

    elements.btnExportCurrentSchema.addEventListener('click', () => {
      const sqlDump = SqlEngine.dumpSql();
      const blob = new Blob([sqlDump], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${elements.sampleDbSelect.value}_schema.sql`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded database SQL schema script!', 'success');
    });

    // CSV Results Export
    elements.btnCopyResultsCsv.addEventListener('click', () => {
      if (!lastExecutedResult || !lastExecutedResult.columns) return;
      const csv = SqlEngine.resultsToCsv(lastExecutedResult.columns, lastExecutedResult.values);
      navigator.clipboard.writeText(csv);
      showToast('Copied query results as CSV to clipboard!', 'success');
    });

    elements.btnDownloadResultsCsv.addEventListener('click', () => {
      if (!lastExecutedResult || !lastExecutedResult.columns) return;
      const csv = SqlEngine.resultsToCsv(lastExecutedResult.columns, lastExecutedResult.values);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_output_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded query output as CSV!', 'success');
    });

    // Demo query trigger
    const btnDemo = document.getElementById('btn-load-demo-query');
    if (btnDemo) {
      btnDemo.addEventListener('click', () => {
        elements.sqlEditor.value = `-- Find students with GPA > 3.5 along with course enrollments\nSELECT \n    s.student_id,\n    s.student_name,\n    s.gpa,\n    c.course_name,\n    e.grade\nFROM students s\nJOIN enrollments e ON s.student_id = e.student_id\nJOIN courses c ON e.course_id = c.course_id\nWHERE s.gpa >= 3.5\nORDER BY s.gpa DESC;`;
        updateEditorGutter();
        executeEditorSql();
      });
    }

    // Quick tag chips in runner
    document.querySelectorAll('.quick-tags-wrap .tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        elements.sqlEditor.value = chip.dataset.template;
        updateEditorGutter();
        executeEditorSql();
      });
    });

    // Vault Modals & Actions
    elements.btnPromptUnlock.addEventListener('click', () => openModal('unlock'));
    document.getElementById('btn-close-unlock-modal').addEventListener('click', closeAllModals);
    document.getElementById('btn-cancel-auth').addEventListener('click', closeAllModals);

    elements.formAuthVault.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sId = document.getElementById('auth-student-id').value.trim();
      const pin = document.getElementById('auth-pin').value.trim();
      const name = document.getElementById('auth-student-name').value.trim();
      const isLab = document.getElementById('auth-lab-mode').checked;

      try {
        const res = await ApiClient.unlockVault(sId, pin, name, isLab);
        ApiClient.setSession(res.token, { studentId: res.studentId, studentName: res.studentName }, isLab);
        closeAllModals();
        updateVaultUI();
        showToast(res.message || 'Vault unlocked successfully!', 'success');
      } catch(err) {
        showToast(err.message || 'Failed to unlock vault.', 'error');
      }
    });

    elements.btnLockVault.addEventListener('click', lockVault);

    document.getElementById('btn-new-query-modal').addEventListener('click', () => openModal('query'));
    document.getElementById('btn-new-note-modal').addEventListener('click', () => openModal('note'));
    document.getElementById('btn-close-query-modal').addEventListener('click', closeAllModals);
    document.getElementById('btn-cancel-query-modal').addEventListener('click', closeAllModals);
    document.getElementById('btn-close-note-modal').addEventListener('click', closeAllModals);
    document.getElementById('btn-cancel-note-modal').addEventListener('click', closeAllModals);

    // Save Query Form
    elements.formSaveQuery.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('modal-query-id').value;
      const title = document.getElementById('modal-query-title').value.trim();
      const subject = document.getElementById('modal-query-subject').value.trim();
      const tags = document.getElementById('modal-query-tags').value;
      const sql = document.getElementById('modal-query-sql').value.trim();
      const notes = document.getElementById('modal-query-notes').value.trim();

      try {
        await ApiClient.saveQuery({ id, title, subject, tags, sql, notes });
        closeAllModals();
        showToast('Query saved to your Student Vault!', 'success');
        loadVaultData();
      } catch(err) {
        showToast(err.message || 'Failed to save query.', 'error');
      }
    });

    // Save Note Form
    elements.formSaveNote.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('modal-note-id').value;
      const title = document.getElementById('modal-note-title').value.trim();
      const subject = document.getElementById('modal-note-subject').value.trim();
      const tags = document.getElementById('modal-note-tags').value;
      const content = document.getElementById('modal-note-content').value.trim();

      try {
        await ApiClient.saveNote({ id, title, subject, tags, content });
        closeAllModals();
        showToast('Study note saved to vault!', 'success');
        loadVaultData();
      } catch(err) {
        showToast(err.message || 'Failed to save note.', 'error');
      }
    });

    // Vault filters
    elements.vaultSearchInput.addEventListener('input', renderVaultGrid);
    elements.vaultTypeFilter.addEventListener('change', renderVaultGrid);
    elements.vaultSubjectFilter.addEventListener('change', renderVaultGrid);

    // Vault Export Buttons (direct, no dropdown)
    elements.btnExportSql.addEventListener('click', (e) => {
      e.preventDefault();
      const token = ApiClient.getToken();
      if (!token) { showToast('Please unlock your vault first.', 'error'); return; }
      window.location.href = `/api/vault/export/sql?token=${token}`;
      showToast('Exporting SQL script...', 'info');
    });

    elements.btnExportJson.addEventListener('click', (e) => {
      e.preventDefault();
      const token = ApiClient.getToken();
      if (!token) { showToast('Please unlock your vault first.', 'error'); return; }
      window.location.href = `/api/vault/export/json?token=${token}`;
      showToast('Exporting JSON backup...', 'info');
    });

    // compat: dropdown toggle (hidden element, no-op)
    elements.btnExportDropdown.addEventListener('click', (e) => e.stopPropagation());

    // Quick Beam Forms
    elements.formCreateBeam.addEventListener('submit', handleCreateBeam);
    elements.formClaimBeam.addEventListener('submit', (e) => {
      e.preventDefault();
      handleClaimBeam();
    });

    document.getElementById('btn-copy-beam-code').addEventListener('click', () => {
      const code = document.getElementById('display-beam-code').textContent;
      navigator.clipboard.writeText(code);
      showToast(`Copied code ${code} to clipboard!`, 'success');
    });

    document.getElementById('btn-copy-beam-url').addEventListener('click', () => {
      const url = document.getElementById('display-beam-url').value;
      navigator.clipboard.writeText(url);
      showToast('Copied direct beam URL to clipboard!', 'success');
    });

    // Community Board
    document.getElementById('btn-open-share-modal').addEventListener('click', () => openModal('community'));
    document.getElementById('btn-close-share-modal').addEventListener('click', closeAllModals);
    document.getElementById('btn-cancel-share-modal').addEventListener('click', closeAllModals);

    elements.formShareCommunity.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('share-query-title').value.trim();
      const author = document.getElementById('share-author-name').value.trim();
      const subject = document.getElementById('share-subject').value.trim();
      const tags = document.getElementById('share-tags').value;
      const sql = document.getElementById('share-sql').value.trim();
      const description = document.getElementById('share-description').value.trim();

      try {
        await ApiClient.shareCommunity({ title, author, subject, tags, sql, description });
        closeAllModals();
        showToast('Query shared on the Class Board for all students!', 'success');
        loadCommunityData();
      } catch(err) {
        showToast(err.message || 'Failed to share query.', 'error');
      }
    });

    document.getElementById('community-search-input').addEventListener('input', () => {
      loadCommunityData();
    });

    document.querySelectorAll('#community-tags-bar .tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#community-tags-bar .tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadCommunityData(chip.dataset.filter);
      });
    });

    // Cheatsheet pill buttons
    document.querySelectorAll('.cheatsheet-nav-pills .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cheatsheet-nav-pills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        CheatsheetModule.init(btn.dataset.cheatTab);
      });
    });

    // Activity tracking for lab mode auto-lock
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
      window.addEventListener(evt, resetActivityTimer, { passive: true });
    });
  }

  // Check URL parameters on load (e.g. ?beam=SQL-4819)
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const beamParam = params.get('beam');
    if (beamParam) {
      switchTab('beam');
      elements.beamCodeInput.value = beamParam.toUpperCase();
      handleClaimBeam(beamParam.toUpperCase());
    }
  }

  // Application Entry Point
  async function init() {
    cacheDom();
    initTheme();
    bindEvents();
    startLabProtection();

    // Default query in editor
    elements.sqlEditor.value = `-- Welcome to EduSQL Lab Sandbox!
-- Test queries here or beam them to your home PC.
SELECT 
    s.student_id,
    s.student_name,
    s.gpa,
    d.dept_name,
    c.course_name,
    e.grade
FROM students s
JOIN departments d ON s.dept_id = d.dept_id
JOIN enrollments e ON s.student_id = e.student_id
JOIN courses c ON e.course_id = c.course_id
ORDER BY s.gpa DESC;`;
    updateEditorGutter();

    // Initialize SQL engine
    const ok = await SqlEngine.init();
    if (ok) {
      refreshSchemaSidebar();
      executeEditorSql();
    }

    updateVaultUI();
    checkUrlParams();
  }

  return {
    init,
    runSelectTable,
    loadSqlToRunner,
    runVaultQuery,
    beamVaultItem,
    openEditQuery,
    openEditNote,
    deleteQuery,
    deleteNote,
    likeCommunity,
    forkToVault
  };
})();

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', App.init);
