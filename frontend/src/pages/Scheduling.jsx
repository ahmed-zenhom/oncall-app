import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function isWeekend(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 5 || d === 6; // Friday, Saturday — per the business rule
}

export default function Scheduling({ team, role, currentUserId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [members, setMembers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canEdit = role === 'SCHEDULER' || role === 'TEAM_ADMIN' || role === 'SUPER_ADMIN';
  const canExport = role === 'SUPER_ADMIN';
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const numDays = daysInMonth(year, month);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([api.teamMembers(team.id), api.schedules(team.id, monthStr)]);
      setMembers(m);
      setSchedules(s);
    } catch (err) {
      setToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [team.id, monthStr]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  function scheduleFor(userId, day) {
    const date = `${monthStr}-${String(day).padStart(2, '0')}`;
    return schedules.find((s) => s.userId === userId && s.date === date);
  }

  function countFor(userId) {
    return schedules.filter((s) => s.userId === userId).length;
  }

  async function toggleCell(userId, day, existing) {
    if (!canEdit) return;
    const date = `${monthStr}-${String(day).padStart(2, '0')}`;
    try {
      if (existing) {
        await api.deleteSchedule(team.id, existing.id);
        setToast(`Removed on-call day ${date}`);
      } else {
        await api.createSchedule(team.id, userId, date);
        setToast(`Added on-call day ${date}`);
      }
      load();
    } catch (err) {
      setToast(err.message);
    }
  }

  async function handleGenerate() {
    setConfirmGenerate(false);
    try {
      const result = await api.generateSchedule(team.id, year, month, false);
      setToast(`Schedule generated for ${result.memberCount} member(s)`);
      load();
    } catch (err) {
      setToast(err.message);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, fileName } = await api.downloadMonthlyExport(monthStr, [team.id]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setToast(`Export downloaded for ${monthName}`);
    } catch (err) {
      setToast(err.message);
    } finally {
      setExporting(false);
    }
  }

  function shiftMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">{team.name} — Schedule</h1>
          <div className="page-sub">{canEdit ? 'Click a cell to toggle an on-call assignment.' : 'Read-only view — ask a scheduler to make changes.'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">◀</button>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 140, textAlign: 'center' }}>{monthName}</div>
          <button className="btn" onClick={() => shiftMonth(1)} aria-label="Next month">▶</button>
          {canEdit && (
            <button className="btn btn-amber" onClick={() => setConfirmGenerate(true)}>
              Auto-generate schedule
            </button>
          )}
          {canExport && (
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Export report'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading schedule…</div>
      ) : members.length === 0 ? (
        <div className="empty-state">This team has no members yet. Add some from User Management.</div>
      ) : (
        <>
          <div className="grid-wrap">
            <table className="sched-grid">
              <thead>
                <tr>
                  <th className="member-col">Member</th>
                  {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => (
                    <th key={day} className={isWeekend(year, month, day) ? 'day-col weekend' : 'day-col'}>
                      {day}<br />{DAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const total = countFor(m.id);
                  return (
                    <tr key={m.id}>
                      <td className="member-col">
                        {m.fullName}{m.id === currentUserId && <span style={{ color: 'var(--text-muted)' }}> (you)</span>}
                      </td>
                      {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
                        const existing = scheduleFor(m.id, day);
                        const weekend = isWeekend(year, month, day);
                        const cls = existing
                          ? existing.type === 'AUTO_WEEKEND' || (existing.type === 'MANUAL' && weekend)
                            ? 'on-weekend'
                            : 'on-weekday'
                          : '';
                        return (
                          <td key={day} className={weekend ? 'day-col weekend' : 'day-col'}>
                            <button
                              className={`cell-btn ${cls}`}
                              disabled={!canEdit}
                              onClick={() => toggleCell(m.id, day, existing)}
                              aria-label={existing ? `Remove on-call on ${monthStr}-${day}` : `Assign on-call on ${monthStr}-${day}`}
                            >
                              {existing && <span className="cell-dot" />}
                            </button>
                          </td>
                        );
                      })}
                      <td>
                        <span className={`count-badge ${total === 10 ? 'ok' : 'warn'}`}>{total}/10</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="legend">
            <span><span className="legend-swatch" style={{ background: 'var(--signal-amber)' }} />Weekend on-call</span>
            <span><span className="legend-swatch" style={{ background: 'var(--teal-700)' }} />Weekday on-call</span>
            <span><span className="legend-swatch" style={{ background: '#fff8ec', border: '1px solid var(--line)' }} />Fri/Sat column</span>
          </div>
        </>
      )}

      {confirmGenerate && (
        <div className="modal-backdrop" onClick={() => setConfirmGenerate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Auto-generate {monthName}?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Every member will get 10 on-call days: all weekend days first (up to 4 weekends), then random weekdays to fill the rest.
              Existing manual entries for this month are kept — automated entries will be recalculated.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmGenerate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleGenerate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
