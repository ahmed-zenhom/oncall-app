# On-Call Scheduler — Working Prototype

A functional implementation of the design in `oncall-scheduling-system-design.md`:
JWT auth, per-team role-based permissions, a scheduling grid, user management,
the 10-day/weekend-priority auto-generation algorithm, and a monthly Excel
export. Backend is Node/Express + SQLite; frontend is React + Vite.
-- this is for testing only--
This is a **working prototype**, not a hardened production build — see
`DEPLOYMENT.md` for what to change before real use (Postgres, secrets, HTTPS, etc.).
## test for syam
## Requirements
- Node.js **22.5 or newer** (uses the built-in `node:sqlite` module — no native
  compilation/build tools required, which keeps setup painless on any OS)

## Quick start

### 1. Backend
```bash
cd backend
npm install
npm run seed      # creates oncall.db with demo users/teams
npm start         # runs on http://localhost:4000
```

Demo accounts (all use password `password123`):
| Email | Role |
|---|---|
| admin@company.com | Super Admin (all teams, can export) |
| alice@company.com | Team Admin — Platform Infra |
| bob@company.com | Scheduler — Platform Infra |
| carol@company.com | Member @ Infra / Team Admin @ Support |
| dave@company.com | Member |

### 2. Frontend
In a second terminal:
```bash
cd frontend
npm install
npm run dev        # runs on http://localhost:5173, proxies API calls to :4000
```

Open `http://localhost:5173` and log in with any demo account above.

### 3. Try it out
- Log in as **alice@company.com** → Schedule tab → "Auto-generate schedule" for
  the current month → watch every member land on exactly 10 days.
- Log in as **dave@company.com** (plain member) → the grid is read-only and
  the "Auto-generate" button doesn't appear, confirming the permission rule.
- Log in as **admin@company.com** and use the new **Export report** button on
  the Schedule page to download the monthly spreadsheet from the UI.
- Log in as **alice@company.com** and use **+ New team** in the sidebar to
  create teams without leaving the app.

## What's implemented vs. stubbed
**Implemented:** login/JWT auth, per-team role enforcement (403 on
insufficient role, 404 on teams you're not in), team member management,
manual + auto-generated scheduling, the exact 10-day/weekend rule from the
spec, audit logging, UI-driven Excel export, and UI team creation.

**Intentionally left as follow-ups** (called out here rather than silently
skipped): a UI button for triggering/downloading exports (currently API-only,
restricted to Super Admin), password reset flow, refresh-token revocation
list, and a cron wrapper for the monthly export job (`DEPLOYMENT.md` shows
where that hooks in).

## Project structure
```
backend/
  server.js           API routes
  db.js               SQLite schema + connection
  auth.js             password hashing, JWT, role-check middleware
  scheduleGenerator.js   the 10-day assignment algorithm
  excelExport.js       .xlsx generation
  seed.js             demo data
frontend/
  src/App.jsx          shell: sidebar, team switcher, tab routing
  src/pages/Login.jsx
  src/pages/Scheduling.jsx
  src/pages/UserManagement.jsx
  src/api.js           fetch wrapper
  src/styles.css        design tokens
docker-compose.yml     two-container local run
```

## Docker

Run the app as containers from the repo root:
```bash
docker compose up --build
```

Then open `http://localhost:8080`. The frontend container serves the React
build, and the backend container handles the API, SQLite database, and export
files with persisted Docker volumes.
