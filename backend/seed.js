// seed.js — creates the initial admin account for a fresh install.
// Run with: npm run seed

const { randomUUID } = require('node:crypto');
const db = require('./db');
const { hashPassword } = require('./auth');

function upsertUser({ email, fullName, password, isSuperAdmin = false }) {
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) return user;
  const id = randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, is_super_admin) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, hashPassword(password), fullName, isSuperAdmin ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

console.log('Seeding initial admin account...');

const admin = upsertUser({
  email: 'dcu@te.eg',
  fullName: 'dcu',
  password: 'DCUKelmetElser',
  isSuperAdmin: true,
});

console.log('Done. Initial admin account:');
console.log('  dcu@te.eg   (super admin)');
