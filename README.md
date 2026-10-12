# GAP Compiler

A SQL playground for students. Run queries in the browser, keep work in **My Zone**, move it between computers with **Quick Share**, and trade solutions on the **Class Board**.

Node 18+ and Express 5. Data lives in JSON files. SQL runs in the browser with SQLite (sql.js), served from `public/vendor`, so nothing needs a CDN.

## Run

```
npm install
npm start          # http://localhost:3000
npm test           # API tests
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | Yes in production | 32+ random characters. Signs login and reset tokens. If unset, a random key is generated in `DATA_DIR/.session-secret`. |
| `DATA_DIR` | Yes on Render | Folder for the JSON data. Default `./data`. Point it at a persistent disk, for example `/var/data`. |
| `PORT` | No | Set by Render. Default 3000. |
| `DISABLE_CSP` | No | Set `1` only to debug if the strict Content-Security-Policy blocks something. |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Deploy on Render

1. Create a **Web Service** from the repo. Build: `npm install`. Start: `npm start`.
2. Add a **Disk** (paid instance types) mounted at `/var/data`, then set `DATA_DIR=/var/data`. **Without a disk, Render wipes the data on every deploy and restart.**
3. Set `SESSION_SECRET`. Health check path: `/healthz`.
4. Deploy. On first start the app backs up `DATA_DIR`, removes the old demo posts, and ignores legacy accounts (see below).

## Accounts and password recovery

- **Student ID** is generated at sign-up (`GAP-123456`), checked for uniqueness inside the same step that saves it, and shown once. Students must keep it.
- Passwords are hashed with scrypt, 8 characters minimum. Sessions are signed tokens: 8 hours on a shared computer, 14 days otherwise. A password reset signs out every session.
- **Forgot password** uses only Student ID plus registered mobile number, as specified. The server checks both (formatting such as spaces and `+91` is ignored), returns a 10-minute single-use token, and then accepts the new password. Wrong details get one generic message. No SMS, OTP, email or social login exists.
- Limits: 5 wrong recovery attempts per account (30 min lock), 15 per network; 8 wrong log-ins per account (15 min lock), 40 per network. Only failures count, so a school lab sharing one address is not locked out by normal use. Limits are per server process.
- **Known limitation:** knowing a Student ID and a mobile number does not prove someone owns that phone. Anyone who learns both can reset the password. Student IDs are never shown to other students (Class Board and Quick Share hide them), but a classmate who knows both could take over an account. If this matters, add a staff-approved reset or a second factor later.
- Mobile numbers are stored as digits so they can be compared. Password hashes and mobile numbers are never returned by any endpoint or written to logs.

## Account reset and data migration

Old EduSQL accounts (`vaults.json`) are never read by the new code, so they cannot sign in. Nothing is deleted automatically. Stop the server before running these.

```
npm run backup                               # verified copy to DATA_DIR/backups/
npm run reset-accounts                       # dry run: lists accounts and what would change
npm run reset-accounts -- --confirm          # backup, then archive vaults.json/beams.json into legacy-<time>/
npm run clean-demo -- --confirm              # remove old demo posts (also runs on start)
npm run restore -- <backup-folder> --confirm # roll back
```

Old students' saved queries and notes are not migrated into the new accounts; they remain in `vaults.json` or `legacy-*/`. Old Quick Beam codes stop working. Demo posts are removed only if id, title and author all match the old seed and the post has no owner, so genuine posts are kept.

**Rollback of a deployment:** redeploy the previous version, stop it, run `npm run restore -- <backup> --confirm`, start it.

## What runs where

- Browser: the SQL engine. Queries are never sent to the server. Very heavy queries can freeze the tab; refresh to recover.
- Server: accounts, My Zone, Quick Share codes, Class Board. Writes are atomic (temp file, then rename) and roll back on failure. A corrupted file is moved aside rather than overwritten.
- Quick Share: signed-in students create codes (8 characters, up to 7 days); anyone with a code can open it. Ownership and expiry are enforced on the server.
- Class Board: reading is public; posting, upvoting and deleting need a login. Authors are set from the account, and only the owner can delete.

JSON files suit a class or school. For many concurrent users, move storage to Postgres (`lib/store.js` is the only storage layer).
