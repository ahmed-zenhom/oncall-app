// auth.js — password hashing, JWT helpers, and the centralized
// authorization middleware described in the design doc (Section 3.6).

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { randomUUID } = require('node:crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, isSuperAdmin: !!user.is_super_admin },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function issueRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

// Middleware: verifies the access token and attaches req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing access token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware factory: requires the caller to hold at least `minRole` on
// req.params.teamId. Role order: MEMBER < SCHEDULER < TEAM_ADMIN.
// SUPER_ADMIN always passes. Returns 404 (not 403) for teams the user has
// no membership in, to avoid team-enumeration (Section 3.6/7.3 of the spec).
const ROLE_RANK = { MEMBER: 1, SCHEDULER: 2, TEAM_ADMIN: 3 };

function requireTeamRole(minRole) {
  return (req, res, next) => {
    if (req.user.is_super_admin) return next();

    const teamId = req.params.teamId;
    const membership = db
      .prepare('SELECT * FROM team_memberships WHERE user_id = ? AND team_id = ?')
      .get(req.user.id, teamId);

    if (!membership) return res.status(404).json({ error: 'Team not found' });

    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: 'Insufficient team role for this action' });
    }
    req.teamMembership = membership;
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user.is_super_admin) return res.status(403).json({ error: 'Super admin only' });
  next();
}

function logAudit(actorId, action, targetType, targetId, metadata) {
  db.prepare(
    `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), actorId, action, targetType, targetId, JSON.stringify(metadata || {}));
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
  requireAuth,
  requireTeamRole,
  requireSuperAdmin,
  logAudit,
  JWT_SECRET,
};
