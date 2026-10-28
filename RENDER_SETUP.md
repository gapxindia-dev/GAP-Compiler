# Render Deployment Guide for GAP Compiler

This guide explains how to deploy the **GAP Compiler** on **Render** so that all user data (accounts, saved queries, class‑board posts, etc.) persists across server sleep cycles, restarts, and redeploys.

---
## Prerequisites
- A Render account with permission to create **Web Services** and **PostgreSQL** databases.
- The repository is already pushed to GitHub (the `main` branch contains the latest code). See the GitHub repo link in the README.
- Node.js 18+ (Render’s default environment). No additional build steps are required beyond `npm install` and `npm start`.

---
## 1. Add a PostgreSQL Instance on Render
1. In the Render dashboard, click **"New" → "PostgreSQL"**.
2. Choose a name (e.g., `gap-compiler-db`).
3. Select a plan (the free tier is sufficient for development; a paid plan is recommended for production).
4. **Create** the database.
5. After creation, copy the **Database URL** (looks like `postgresql://<user>:<password>@<host>:5432/<dbname>`).

---
## 2. Create the Web Service
1. Click **"New" → "Web Service"**.
2. Connect the service to your GitHub repository (the GAP‑Compiler repo).
3. Set **Branch** to `main`.
4. **Build Command**: `npm install`
5. **Start Command**: `npm start`
6. **Environment** – add the following variables:
   - `DATABASE_URL` – paste the URL copied from the PostgreSQL instance.
   - `SESSION_SECRET` – a long random string (32+ characters). If omitted, the app will generate one on first start and store it in the DB, but setting it explicitly avoids a secret change on first boot.
   - (Optional) `PORT` – Render automatically provides `$PORT`. The code already uses `process.env.PORT || 3000`.
7. **Instance Type** – choose a size that meets your traffic needs (e.g., “Free” for testing).
8. **Deploy** the service.

---
## 3. Verify the Service Starts with PostgreSQL
- After the first deploy, check the service logs. You should see a line similar to:
  ```
  Storage backend: PostgreSQL
  ```
- If you see any connection errors, confirm that `DATABASE_URL` is correct and that the database is reachable (Render allows intra‑service networking by default).

---
## 4. Data Persistence Across Sleeps/Restarts
Render’s free tier containers are **ephemeral** – any files written to the local filesystem disappear when the service sleeps or restarts. By using the PostgreSQL backend (`PgStore`), all critical data is stored in the external database, which **survives** container lifecycles.

### What is persisted in the DB?
- User accounts (`users` table)
- Password hashes (`password_hash` column)
- Saved SQL queries (`saved_queries` table)
- Class‑Board posts (`class_board_posts` table)
- Application metadata, including the `SESSION_SECRET`

No data is written to the local `data/` folder after the switch to PostgreSQL, so you can safely let Render sleep.

---
## 5. (Optional) Attach a Disk for Backups
While the DB holds the source of truth, you may want a **Render Disk** to store periodic JSON backups or logs.
1. Create a Disk (e.g., 1 GB) in Render.
2. Attach it to the web service and set an environment variable:
   - `DATA_DIR=/var/data`
3. The app will write backups to `${DATA_DIR}/backup.json` when the `scripts/migrate.js` script is run.

---
## 6. Testing Persistence
1. Open the live URL of your Render service.
2. Register a new user, log in, and create a saved query and a Class‑Board post.
3. From the Render dashboard, click **"Restart"** or wait for the service to sleep (you can force a restart via the UI).
4. Reload the URL, log in with the same credentials, and verify that the saved query and post are still present.

If everything shows up, the deployment is **Render‑ready** with persistent data.

---
## 7. Common Pitfalls & Troubleshooting
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `Error: ER_NO_SUCH_TABLE` or missing tables | Database not migrated | The app runs migrations automatically on first start. Ensure the `DATABASE_URL` points to an empty DB, then redeploy. |
| Sessions reset after restart | `SESSION_SECRET` not set or not persisted | Set a fixed `SESSION_SECRET` env‑var, or let the app generate one (it stores it in the `app_meta` table after first start). |
| Connection timeout | Render network rules or wrong port | Verify the DB URL is correct; Render allows outbound connections to its own PostgreSQL add‑on without extra VPC configuration. |

---
## 8. Quick Reference Checklist
- [ ] Create PostgreSQL instance → copy URL.
- [ ] Add `DATABASE_URL` (and optional `SESSION_SECRET`) env vars to the Web Service.
- [ ] Deploy – verify `Storage backend: PostgreSQL` in logs.
- [ ] Test user flow, restart service, confirm data persists.
- [ ] (Optional) Attach Disk & set `DATA_DIR`.

---
**Enjoy a stable, persistent GAP Compiler on Render!**
