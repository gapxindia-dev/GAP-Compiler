# GAP Compiler

A modern, reliable SQL playground, workspace and Class Board for students. Run SQL queries in the browser, keep work organized in **My Zone**, transfer snippets between computers with **Quick Share**, and swap solutions on the **Class Board**.

Built with Node 18+, Express 5, and persistent storage support for PostgreSQL (Render Postgres, Neon, Supabase) and atomic local storage. SQL runs locally in the browser using SQLite (sql.js WebAssembly), so queries never hit the network or third-party servers.

---

## Quick Start

```bash
npm install
npm start          # Runs at http://localhost:3000
npm test           # Runs test suite (API, persistence, and SQL engine)
```

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes on Render (Production)** | PostgreSQL connection string (e.g. from Render PostgreSQL, Neon, Supabase). **Permanently eliminates data loss across Render sleep/wake cycles, restarts, and redeployments.** |
| `SESSION_SECRET` | Recommended | 32+ random characters. Signs authentication and reset tokens. If unset, a secure secret is generated and persisted in PostgreSQL / data directory so sessions survive restarts. |
| `DATA_DIR` | Optional | Directory for local file storage and backups. Default `./data`. |
| `PORT` | No | Port assigned by Render or hosting provider. Default `3000`. |
| `DISABLE_CSP` | No | Set `1` to disable Content Security Policy headers for local testing. |

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Permanent Persistence on Render (Setup Guide)

To permanently fix data loss when Render sleeps or restarts:

1. **Create a PostgreSQL Database on Render**:
   - In your Render Dashboard, click **New +** > **PostgreSQL**.
   - Choose a name (e.g. `gap-compiler-db`) and select the Free or Starter tier.
   - Click **Create Database**.
2. **Copy the Connection String**:
   - Once provisioned, copy the **Internal Database URL** (if your web service is in the same Render region) or **External Database URL**.
3. **Configure Your Web Service**:
   - In your GAP Compiler Web Service settings on Render, navigate to **Environment**.
   - Add the environment variable:
     - Key: `DATABASE_URL`
     - Value: `<your-copied-database-url>`
   - Add `SESSION_SECRET`:
     - Key: `SESSION_SECRET`
     - Value: `<a-random-32+-character-string>`
4. **Deploy**:
   - On deployment, the GAP Compiler server connects to PostgreSQL, automatically applies all database migrations, and creates tables (`users`, `zone_queries`, `zone_notes`, `shares`, `community`, `app_meta`).
   - If local files exist, it automatically migrates existing student accounts (including `ANUB0001`), saved queries, notes, and Class Board posts into PostgreSQL without losing records.
   - All student accounts, queries, and board posts now permanently survive container sleep cycles, restarts, and redeployments!

---

## Features & Audit Fixes

### 1. Data Loss Fix (PostgreSQL Persistent Storage)
- **Root Cause**: Render Web Services run on ephemeral container filesystems. Previous versions saved user accounts and queries to `./data/*.json`, which was completely wiped when Render put inactive services to sleep (after 15 minutes on the free tier), restarted, or redeployed. Furthermore, session signing secrets were regenerated on restart, invalidating all student logins.
- **Fix**: Implemented a unified storage architecture (`lib/pg-store.js` and `lib/store.js`). With `DATABASE_URL`, all records are persistently stored in PostgreSQL with ACID transactions. Local files are automatically backed up and safely migrated on first startup without deleting or resetting accounts. Session secrets are persisted so students remain signed in.

### 2. SQL Editor Text Alignment & Gutter Fixes
- **Root Cause**:
  1. Global CSS rule `*, *::before, *::after { box-sizing: border-box; }` clashed with CodeMirror's internal mathematical coordinate calculations for `.CodeMirror-lines`, character width measurements, and line wrappers.
  2. Conflicting `padding: 0 4px` on `.CodeMirror-gutters` caused line numbers to desynchronize horizontally with the editor text.
  3. The editor lacked explicit `line-height` parity between line numbers (`.CodeMirror-linenumber`) and code lines (`.CodeMirror pre.CodeMirror-line`), causing vertical drift on multiline queries.
  4. With `lineWrapping: true`, horizontal drag/selection or wide tokens caused native horizontal scrolling that shifted text to the left under the gutter with no horizontal scrollbar to recover it.
  5. The editor container was hidden (`display: none`) on initial load and web fonts loaded asynchronously without triggering a CodeMirror measurement recalculation.
- **Fix**:
  - Scoped `.CodeMirror, .CodeMirror *` to `box-sizing: content-box !important`.
  - Removed disruptive padding from `.CodeMirror-gutters`.
  - Harmonized `line-height: 1.6` across code lines and line numbers for 1:1 alignment.
  - Set `lineWrapping: false` as default with native horizontal scrolling (`overflow-x: auto`), pinned gutter (`fixedGutter: true`), and an interactive "Wrap" toggle button in the toolbar.
  - Added `ResizeObserver`, font loading listener (`document.fonts.ready`), and window resize listener to trigger `cm.refresh()` dynamically when dimensions or zoom levels change.

### 3. SQL Execution & Results Panel
- **Loading State & Anti-Spam**: Run button displays a loading spinner and disables during query execution to prevent duplicate submissions or UI locks.
- **Multiple Result Sets**: When queries return multiple result sets, clean tab navigation (`Result 1`, `Result 2`, etc.) allows students to view each result table and export CSVs for the active set.
- **Readable Column Formatting**: Long column names feature native tooltips, numeric columns are right-aligned, null values render as distinct italic badges, and wide tables scroll smoothly within `.table-wrap` without overflowing the playground layout.
- **Targeted SQL Error Tips**: Common SQL errors (misspelled tables, syntax errors, ambiguous columns, foreign key violations) return actionable diagnostic guidance.

### 4. Class Board & My Zone
- Authenticated accounts are permanently linked to queries and notes.
- Security restriction preserved: students can only edit or delete their own posts.
- Private student queries in My Zone are completely isolated and never exposed to other students.

---

## Operator & Maintenance Scripts

```bash
node scripts/migrate.js status            # Show storage backend and record summary
node scripts/migrate.js backup            # Snapshot current records to data/backups/
node scripts/migrate.js reset-accounts    # Dry run for account archiving (requires --confirm)
node scripts/migrate.js clean-demo        # Remove obsolete demo seed posts (requires --confirm)
node scripts/migrate.js restore <folder>  # Restore from a backup folder (requires --confirm)
```

---

## Automated Tests

Run the test suite:
```bash
npm test
```
Includes:
- API authentication, password recovery rate limiting, session TTL.
- Class Board permissions and My Zone isolation.
- `PgStore` schema generation, transactions, rollbacks, and file migrations.
- SQL Engine formatting, CSV export, and error tip generation.
- End-to-end data persistence across simulated restarts.
