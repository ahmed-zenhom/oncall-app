// server.js — Express API entry point.
// Routes map directly to the endpoint table in Section 3 of the design doc.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

const db = require('./db');
const {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
  requireAuth,
  requireTeamRole,
  requireSuperAdmin,
  logAudit,
  JWT_SECRET,
} = require('./auth');
const { generateMonthlySchedule } = require('./scheduleGenerator');
const { generateExcelExport } = require('./excelExport');

const app = express();
app.use(cors());
app.use(express.json());

const EXPORT_DIR = process.env.EXPORT_DIR || path.join(__dirname, 'exports');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isTeEgEmail(email) {
  return normalizeEmail(email).endsWith('@te.eg');
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(normalizeEmail(email));
  // Same generic error whether the email doesn't exist or the password is wrong,
  // so we never reveal which one was incorrect (Section 4.1 / 7.1 of the design doc).
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, isSuperAdmin: !!user.is_super_admin },
  });
});

app.post('/auth/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token' });
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);
    if (payload.type !== 'refresh') throw new Error('wrong token type');
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ accessToken: issueAccessToken(user) });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

app.get('/auth/me', requireAuth, (req, res) => {
  const memberships = db
    .prepare(
      `SELECT tm.team_id as teamId, t.name as teamName, tm.role
       FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ?`
    )
    .all(req.user.id);
  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.full_name,
    isSuperAdmin: !!req.user.is_super_admin,
    memberships,
  });
});

// ---------------------------------------------------------------------------
// TEAMS & MEMBERSHIP
// ---------------------------------------------------------------------------

app.get('/teams', requireAuth, (req, res) => {
  if (req.user.is_super_admin) {
    return res.json(db.prepare('SELECT * FROM teams ORDER BY name').all());
  }
  const teams = db
    .prepare(
      `SELECT t.* FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id
       WHERE tm.user_id = ? ORDER BY t.name`
    )
    .all(req.user.id);
  res.json(teams);
});

app.post('/teams', requireAuth, requireSuperAdmin, (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Team name is required' });
  const id = randomUUID();
  db.prepare('INSERT INTO teams (id, name, description) VALUES (?, ?, ?)').run(id, name, description || null);
  logAudit(req.user.id, 'TEAM_CREATED', 'team', id, { name });
  res.status(201).json({ id, name, description });
});

app.get('/teams/:teamId/members', requireAuth, requireTeamRole('MEMBER'), (req, res) => {
  const members = db
    .prepare(
      `SELECT u.id, u.full_name as fullName, u.email, u.is_active as isActive, tm.role, tm.joined_at as joinedAt
       FROM team_memberships tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY u.full_name`
    )
    .all(req.params.teamId);
  res.json(members);
});

app.post('/teams/:teamId/members', requireAuth, requireTeamRole('TEAM_ADMIN'), (req, res) => {
  const { email, fullName, role, password } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role are required' });
  if (!['MEMBER', 'SCHEDULER', 'TEAM_ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isTeEgEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Only @te.eg email addresses are allowed' });
  }

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    if (!fullName || !password) {
      return res.status(400).json({ error: 'fullName and password are required to create a new user' });
    }
    const id = randomUUID();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)'
    ).run(id, normalizedEmail, hashPassword(password), fullName);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const existing = db
    .prepare('SELECT * FROM team_memberships WHERE user_id = ? AND team_id = ?')
    .get(user.id, req.params.teamId);
  if (existing) return res.status(409).json({ error: 'User is already a member of this team' });

  const membershipId = randomUUID();
  db.prepare(
    'INSERT INTO team_memberships (id, user_id, team_id, role) VALUES (?, ?, ?, ?)'
  ).run(membershipId, user.id, req.params.teamId, role);

  logAudit(req.user.id, 'MEMBER_ADDED', 'team_membership', membershipId, { userId: user.id, role });
  res.status(201).json({ id: user.id, fullName: user.full_name, email: user.email, role });
});

app.patch('/teams/:teamId/members/:userId', requireAuth, requireTeamRole('TEAM_ADMIN'), (req, res) => {
  const { role } = req.body || {};
  if (!['MEMBER', 'SCHEDULER', 'TEAM_ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const result = db
    .prepare('UPDATE team_memberships SET role = ? WHERE team_id = ? AND user_id = ?')
    .run(role, req.params.teamId, req.params.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Membership not found' });

  logAudit(req.user.id, 'MEMBER_ROLE_CHANGED', 'team_membership', req.params.userId, { newRole: role });
  res.json({ userId: req.params.userId, role });
});

app.delete('/teams/:teamId/members/:userId', requireAuth, requireTeamRole('TEAM_ADMIN'), (req, res) => {
  db.prepare('DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?').run(
    req.params.teamId,
    req.params.userId
  );
  logAudit(req.user.id, 'MEMBER_REMOVED', 'team_membership', req.params.userId, {});
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// SCHEDULES
// ---------------------------------------------------------------------------

app.get('/teams/:teamId/schedules', requireAuth, requireTeamRole('MEMBER'), (req, res) => {
  const month = req.query.month; // 'YYYY-MM'
  if (!month) return res.status(400).json({ error: 'month query param (YYYY-MM) is required' });

  const rows = db
    .prepare(
      `SELECT s.id, s.user_id as userId, u.full_name as fullName, s.on_call_date as date, s.assignment_type as type
       FROM schedules s JOIN users u ON u.id = s.user_id
       WHERE s.team_id = ? AND s.on_call_date LIKE ?
       ORDER BY u.full_name, s.on_call_date`
    )
    .all(req.params.teamId, `${month}-%`);
  res.json(rows);
});

app.post('/teams/:teamId/schedules/generate', requireAuth, requireTeamRole('SCHEDULER'), (req, res) => {
  const { year, month, overwriteManual } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

  const result = generateMonthlySchedule(db, {
    teamId: req.params.teamId,
    year,
    month,
    triggeredBy: req.user.id,
    overwriteManual: !!overwriteManual,
  });

  logAudit(req.user.id, 'SCHEDULE_GENERATED', 'team', req.params.teamId, { year, month, ...result });
  res.json({ message: 'Schedule generated', ...result });
});

app.post('/teams/:teamId/schedules', requireAuth, requireTeamRole('SCHEDULER'), (req, res) => {
  const { userId, date } = req.body || {};
  if (!userId || !date) return res.status(400).json({ error: 'userId and date are required' });

  const isMember = db
    .prepare('SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?')
    .get(req.params.teamId, userId);
  if (!isMember) return res.status(400).json({ error: 'User is not a member of this team' });

  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO schedules (id, team_id, user_id, on_call_date, assignment_type, created_by)
       VALUES (?, ?, ?, ?, 'MANUAL', ?)`
    ).run(id, req.params.teamId, userId, date, req.user.id);
  } catch (err) {
    return res.status(409).json({ error: 'This user already has an assignment on that date' });
  }

  logAudit(req.user.id, 'SCHEDULE_CREATED', 'schedule', id, { userId, date });
  res.status(201).json({ id, userId, date, type: 'MANUAL' });
});

app.patch('/teams/:teamId/schedules/:scheduleId', requireAuth, requireTeamRole('SCHEDULER'), (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });

  const result = db
    .prepare(
      `UPDATE schedules SET on_call_date = ?, assignment_type = 'MANUAL', updated_at = datetime('now')
       WHERE id = ? AND team_id = ?`
    )
    .run(date, req.params.scheduleId, req.params.teamId);
  if (result.changes === 0) return res.status(404).json({ error: 'Schedule entry not found' });

  logAudit(req.user.id, 'SCHEDULE_UPDATED', 'schedule', req.params.scheduleId, { newDate: date });
  res.json({ id: req.params.scheduleId, date, type: 'MANUAL' });
});

app.delete('/teams/:teamId/schedules/:scheduleId', requireAuth, requireTeamRole('SCHEDULER'), (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ? AND team_id = ?').run(req.params.scheduleId, req.params.teamId);
  logAudit(req.user.id, 'SCHEDULE_DELETED', 'schedule', req.params.scheduleId, {});
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// EXCEL EXPORT
// ---------------------------------------------------------------------------

app.post('/exports/monthly', requireAuth, requireSuperAdmin, async (req, res) => {
  const { month, teamIds } = req.body || {}; // month = 'YYYY-MM'
  if (!month) return res.status(400).json({ error: 'month is required' });

  try {
    const filePath = await generateExcelExport(db, { month, teamIds, outputDir: EXPORT_DIR });
    const id = randomUUID();
    db.prepare(
      'INSERT INTO excel_exports (id, month, file_path, generated_by) VALUES (?, ?, ?, ?)'
    ).run(id, month, filePath, req.user.id);
    logAudit(req.user.id, 'EXCEL_EXPORTED', 'export', id, { month });
    res.status(201).json({ id, month, downloadUrl: `/exports/${id}/download` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export generation failed' });
  }
});

app.get('/exports', requireAuth, requireSuperAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM excel_exports ORDER BY generated_at DESC').all());
});

app.get('/exports/:id/download', requireAuth, requireSuperAdmin, (req, res) => {
  const record = db.prepare('SELECT * FROM excel_exports WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Export not found' });
  res.download(record.file_path);
});

// ---------------------------------------------------------------------------

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`On-call API listening on port ${PORT}`));
