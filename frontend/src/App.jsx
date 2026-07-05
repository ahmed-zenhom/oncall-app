import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Scheduling from './pages/Scheduling';
import UserManagement from './pages/UserManagement';
import { api, clearTokens, hasSession } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [tab, setTab] = useState('schedule');
  const [checking, setChecking] = useState(true);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: '', description: '' });
  const [teamError, setTeamError] = useState('');
  const [teamSaving, setTeamSaving] = useState(false);

  useEffect(() => {
    // A hard refresh clears the in-memory token by design (Section 7.2) —
    // this just avoids an infinite spinner on load.
    setChecking(false);
  }, []);

  async function loadSession(loggedInUser) {
    const me = await api.me();
    setUser({ ...loggedInUser, isSuperAdmin: me.isSuperAdmin, memberships: me.memberships });

    let teamList;
    if (me.isSuperAdmin) {
      teamList = await api.teams();
      teamList = teamList.map((t) => ({ ...t, role: 'SUPER_ADMIN' }));
    } else {
      teamList = me.memberships.map((m) => ({ id: m.teamId, name: m.teamName, role: m.role }));
    }
    setTeams(teamList);
    if (teamList.length > 0) setActiveTeamId(teamList[0].id);
  }

  async function reloadTeams(preferredTeamId = null) {
    if (!user?.isSuperAdmin) {
      const me = await api.me();
      const teamList = me.memberships.map((m) => ({ id: m.teamId, name: m.teamName, role: m.role }));
      setTeams(teamList);
      setActiveTeamId(teamList[0]?.id ?? null);
      return;
    }

    const teamList = (await api.teams()).map((t) => ({ ...t, role: 'SUPER_ADMIN' }));
    setTeams(teamList);

    if (preferredTeamId && teamList.some((team) => team.id === preferredTeamId)) {
      setActiveTeamId(preferredTeamId);
      return;
    }

    if (!teamList.some((team) => team.id === activeTeamId)) {
      setActiveTeamId(teamList[0]?.id ?? null);
    }
  }

  async function handleCreateTeam(e) {
    e.preventDefault();
    setTeamError('');
    if (!teamForm.name.trim()) {
      setTeamError('Team name is required');
      return;
    }

    setTeamSaving(true);
    try {
      const created = await api.createTeam({
        name: teamForm.name.trim(),
        description: teamForm.description.trim() || undefined,
      });
      await reloadTeams(created.id);
      setShowTeamModal(false);
      setTeamForm({ name: '', description: '' });
      setTab('schedule');
    } catch (err) {
      setTeamError(err.message);
    } finally {
      setTeamSaving(false);
    }
  }

  function handleLogout() {
    clearTokens();
    setUser(null);
    setTeams([]);
    setActiveTeamId(null);
  }

  if (checking) return null;

  if (!user || !hasSession()) {
    return <Login onLoggedIn={(u) => loadSession(u)} />;
  }

  const activeTeam = teams.find((t) => t.id === activeTeamId);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="beacon" />
          On-Call
        </div>

        <div className="team-list-label">Your teams</div>
        {user.isSuperAdmin && (
          <button className="nav-item" onClick={() => setShowTeamModal(true)} style={{ marginBottom: 8 }}>
            + New team
          </button>
        )}
        <div className="team-list">
          {teams.map((t) => (
            <button
              key={t.id}
              className={`team-item ${t.id === activeTeamId ? 'active' : ''}`}
              onClick={() => setActiveTeamId(t.id)}
            >
              <span>{t.name}</span>
              <span className="role-tag">{t.role.replace('_', ' ')}</span>
            </button>
          ))}
          {teams.length === 0 && (
            <div style={{ color: '#8892a6', fontSize: 13, padding: '8px 10px' }}>No teams yet</div>
          )}
        </div>

        {activeTeam && (
          <>
            <div className="team-list-label">{activeTeam.name}</div>
            <div className="sidebar-nav">
              <button className={`nav-item ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>
                Schedule
              </button>
              <button className={`nav-item ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
                User Management
              </button>
            </div>
          </>
        )}

        <button className="signout" onClick={handleLogout}>Sign out ({user.email})</button>
      </aside>

      <main className="main">
        {!activeTeam ? (
          <div className="empty-state">You're not assigned to any team yet. Ask an admin to add you.</div>
        ) : tab === 'schedule' ? (
          <Scheduling team={activeTeam} role={activeTeam.role} currentUserId={user.id} />
        ) : (
          <UserManagement team={activeTeam} role={activeTeam.role} />
        )}
      </main>

      {showTeamModal && (
        <div className="modal-backdrop" onClick={() => setShowTeamModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create a team</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              New teams are available immediately and can be managed from the same sidebar.
            </p>
            {teamError && <div className="error-box">{teamError}</div>}
            <form onSubmit={handleCreateTeam}>
              <div className="field">
                <label>Team name</label>
                <input
                  value={teamForm.name}
                  onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input
                  value={teamForm.description}
                  onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowTeamModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={teamSaving}>
                  {teamSaving ? 'Creating...' : 'Create team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
