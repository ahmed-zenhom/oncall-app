import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const ROLES = ['MEMBER', 'SCHEDULER', 'TEAM_ADMIN'];

function isTeEgEmail(email) {
  return email.trim().toLowerCase().endsWith('@te.eg');
}

export default function UserManagement({ team, role }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', role: 'MEMBER' });
  const [error, setError] = useState('');

  const canManage = role === 'TEAM_ADMIN' || role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await api.teamMembers(team.id));
    } catch (err) {
      setToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [team.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleRoleChange(userId, newRole) {
    try {
      await api.updateMemberRole(team.id, userId, newRole);
      setToast('Role updated');
      load();
    } catch (err) {
      setToast(err.message);
    }
  }

  async function handleRemove(userId, name) {
    if (!confirm(`Remove ${name} from ${team.name}?`)) return;
    try {
      await api.removeMember(team.id, userId);
      setToast(`${name} removed from the team`);
      load();
    } catch (err) {
      setToast(err.message);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!isTeEgEmail(normalizedEmail)) {
      setError('Email addresses must use the @te.eg domain');
      return;
    }
    try {
      await api.addMember(team.id, { ...form, email: normalizedEmail });
      setToast(`${normalizedEmail} added to ${team.name}`);
      setShowAdd(false);
      setForm({ email: '', fullName: '', password: '', role: 'MEMBER' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">{team.name} — Team Members</h1>
          <div className="page-sub">
            {canManage ? 'Add members and control who can schedule.' : 'Read-only directory — you need Team Admin to make changes.'}
          </div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add member</button>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          Team role guide
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Member:</strong> can view the schedule and team roster.
          <br />
          <strong style={{ color: 'var(--text-primary)' }}>Scheduler:</strong> can create, edit, and generate on-call assignments.
          <br />
          <strong style={{ color: 'var(--text-primary)' }}>Team Admin:</strong> has scheduler access plus can add, remove, and re-role team members.
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">Loading members…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.fullName}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{m.email}</td>
                  <td>
                    {canManage ? (
                      <select value={m.role} onChange={(e) => handleRoleChange(m.id, e.target.value)}>
                        {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                      </select>
                    ) : (
                      <span className={`role-badge ${m.role}`}>{m.role.replace('_', ' ')}</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td>
                      <button className="btn btn-danger" onClick={() => handleRemove(m.id, m.fullName)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add a member</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              If the email doesn't exist yet, a new account is created.
            </p>
            {error && <div className="error-box">{error}</div>}
            <form onSubmit={handleAdd}>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  placeholder="name@te.eg"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <div className="field-hint">Only `@te.eg` addresses are allowed.</div>
              </div>
              <div className="field">
                <label>Full name (for new accounts)</label>
                <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div className="field">
                <label>Temporary password (for new accounts)</label>
                <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add member</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
