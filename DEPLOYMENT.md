# Deployment Guide

This runbook covers taking the prototype in this repo to a real deployment.
It's organized so you can stop at "small team, low stakes" or keep going to
"production, multi-team, HR-sensitive data" depending on your needs.

---

## 0. Before you deploy anywhere

Two things in the prototype are placeholders and must change first:

1. **`JWT_SECRET`** — currently defaults to `'dev-secret-change-me'` in
   `backend/auth.js`. Generate a real secret and set it as an environment
   variable; never commit it.
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
2. **Demo accounts** — `seed.js` creates accounts with the password
   `password123`. Don't run `npm run seed` against a real deployment; create
   your first Super Admin manually (see Section 4) instead.

---

## 1. Pick a hosting shape

| Option | Good for | What you get |
|---|---|---|
| **Single VM/VPS** (DigitalOcean, Linode, Lightsail) | Small team, simplest mental model | Full control; you manage OS updates, backups, TLS yourself |
| **PaaS** (Render, Railway, Fly.io) | Fastest path to production, small-to-mid team | Managed builds/deploys, managed Postgres add-on, auto TLS |
| **Containers on a cloud provider** (AWS ECS/Fargate, GCP Cloud Run) | Larger org, existing cloud infra/IAM to plug into | Auto-scaling, integrates with existing VPC/secrets manager |

For a first production deployment, a PaaS (Render or Railway) is the
pragmatic choice: you get a managed Postgres instance and HTTPS without
standing up infrastructure, and both support cron-style scheduled jobs for
the monthly export.

---

## 2. Database: move from SQLite to Postgres

The prototype uses SQLite (via Node's built-in `node:sqlite`) so it runs
with zero setup. For real deployment, move to Postgres — SQLite's
single-writer model doesn't hold up once more than one backend instance is
writing concurrently, and PaaS platforms expect a network database anyway.

Steps:
1. Provision a managed Postgres instance (Render/Railway/RDS all offer one).
2. Replace `backend/db.js`'s connection with a Postgres client (`pg` or
   `postgres` npm package). The schema in `db.js` was deliberately written in
   near-standard SQL — the main changes needed are:
   - `TEXT PRIMARY KEY` → keep UUIDs, but generate them with
     `gen_random_uuid()` (enable the `pgcrypto` extension) or continue
     generating them in application code as the prototype already does.
   - `datetime('now')` → `now()`.
   - SQLite's `CHECK (role IN (...))` syntax works unchanged in Postgres.
3. Run the schema once against the new database (a proper migration tool —
   Prisma Migrate, node-pg-migrate, or Knex migrations — is worth adopting
   at this point rather than hand-run SQL files).
4. Point `DATABASE_URL` at the managed instance via environment variable.

---

## 3. Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `JWT_SECRET` | Signs access/refresh tokens | (48-byte random hex) |
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@host:5432/oncall` |
| `PORT` | Backend listen port | `4000` |
| `CORS_ORIGIN` | Restrict CORS to your frontend's real domain instead of `*` | `https://oncall.yourcompany.com` |
| `EXPORT_DIR` or object storage config | Where generated `.xlsx` files land | S3 bucket + credentials, or a persistent volume |

Update `backend/server.js`'s `cors()` call to pass `{ origin: process.env.CORS_ORIGIN }` instead of the current wide-open default before going live.

---

## 4. Creating the first real admin account

Don't ship the seed script's demo passwords. Instead, run a one-off script
against the production database once, then delete it:

```js
// scripts/create-first-admin.js — run once, then remove
const { hashPassword } = require('../backend/auth');
const db = require('../backend/db');
const { v4: uuidv4 } = require('uuid');

const id = uuidv4();
db.prepare(
  'INSERT INTO users (id, email, password_hash, full_name, is_super_admin) VALUES (?, ?, ?, ?, 1)'
).run(id, 'you@yourcompany.com', hashPassword('a-strong-temporary-password'), 'Your Name');
console.log('Created super admin:', id);
```
Log in once, then use `/auth/change-password` to set a real password.

---

## 5. Backend deployment (example: Render)

1. Push this repo to GitHub.
2. Create a new **Web Service** on Render pointing at `backend/`.
   - Build command: `npm install`
   - Start command: `npm start`
   - Add the environment variables from Section 3.
3. Create a **Postgres** instance on Render, copy its connection string into `DATABASE_URL`.
4. Render provisions HTTPS automatically on its `*.onrender.com` domain (or attach your own domain + TLS cert).

The same steps apply nearly unchanged on Railway or Fly.io — the concepts (build command, start command, env vars, managed Postgres add-on) are standard across PaaS providers.

---

## 6. Frontend deployment

The frontend is a static build (`npm run build` in `frontend/` produces `dist/`). Deploy it to any static host:
- **Vercel/Netlify**: connect the repo, set build command `npm run build`, publish directory `dist`.
- **Same PaaS as backend**: most platforms can serve a static site alongside the API.

Before building for production, update API calls to hit your real backend URL instead of relying on the Vite dev proxy — either:
- Set `VITE_API_BASE_URL` as a build-time env var and prefix requests in `src/api.js`, or
- Serve frontend and backend from the same domain (e.g., backend at `/api/*`, frontend elsewhere) and adjust `fetch` paths accordingly.

---

## 7. Wiring up the monthly Excel export job

The export endpoint (`POST /exports/monthly`) already exists — it just needs something to call it on a schedule instead of relying on someone remembering to click a button (Section 3.5/5.4 of the design doc).

Options, roughly in order of setup effort:
1. **PaaS-native cron** (Render Cron Jobs, Railway Cron): schedule a small script that calls the export endpoint with a service-account token, once a month.
2. **GitHub Actions scheduled workflow**: a `schedule:` cron trigger that curls the endpoint — simplest if you don't want another moving piece.
3. **In-process scheduler** (e.g. `node-cron` inside the backend itself): fewer moving parts, but ties the job's reliability to the web process staying up.

Whichever you choose, the job should:
- Call with a **service-account credential**, not a personal admin's token (create a dedicated non-human Super Admin user for this).
- On success, store the resulting file in durable storage (S3 or equivalent) rather than local disk — local disk on most PaaS platforms is ephemeral and wiped on redeploy.
- Optionally, email the HR distribution list a link or attach the file, using a transactional email provider (SendGrid, Postgres, SES).

---

## 8. File storage for exports

The prototype writes `.xlsx` files to `backend/exports/` on local disk — fine for a demo, not for production (ephemeral filesystems, no redundancy). Swap `excelExport.js`'s `outputDir` write for an upload to S3 (or GCS/Azure Blob), and change `GET /exports/:id/download` to redirect to a short-lived signed URL instead of `res.download()` from local disk.

---

## 9. Observability & backups

- **Logging**: ship backend logs (stdout/stderr) to your platform's log aggregator, or add a lightweight logger (pino) if you need structured logs.
- **Error tracking**: wire up Sentry or similar — schedule-affecting bugs are the kind you want to hear about immediately.
- **Backups**: enable automatic daily backups on the managed Postgres instance (Render/Railway/RDS all offer this as a checkbox). This data affects pay — treat backups as non-optional.
- **Uptime monitoring**: a simple ping against `GET /health` from an external monitor (UptimeRobot, Better Uptime) catches outages before HR notices a missing export.

---

## 10. Security checklist before go-live

- [ ] `JWT_SECRET` is a real random value, stored as a secret (not in source)
- [ ] `CORS_ORIGIN` restricted to the real frontend domain
- [ ] HTTPS enforced end-to-end (most PaaS platforms do this by default)
- [ ] Seed script's demo accounts are not present in the production database
- [ ] Rate limiting added to `/auth/login` (e.g. `express-rate-limit`) — not yet in the prototype
- [ ] Refresh tokens are checked against a revocation list on logout (the prototype's refresh tokens are stateless JWTs; Section 7.2 of the design doc calls out that a production build should store/hash them server-side so they can be revoked)
- [ ] Database backups enabled and tested (a real restore, not just "backups exist")
- [ ] Export files live in access-controlled object storage, not local disk

---

## 11. Suggested rollout order

1. Deploy backend + Postgres, run schema, create first Super Admin (Sections 2–4).
2. Deploy frontend pointed at the real backend URL (Section 6).
3. Manually create your real teams and team admins through the UI (no need for the seed script).
4. Run one manual `/exports/monthly` call and sanity-check the spreadsheet against expectations before automating it.
5. Wire up the scheduled job (Section 7) once the manual export looks right.
6. Work through the security checklist (Section 10) before announcing it to the org.
