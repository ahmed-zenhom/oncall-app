// api.js — thin fetch wrapper. Access token kept in memory only (not
// localStorage) per the security guidance in the design doc (Section 7.2).

let accessToken = null;
let refreshToken = null;

export function setTokens(tokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken ?? refreshToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

export function hasSession() {
  return !!accessToken;
}

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && refreshToken) {
    // Access token likely expired — try a silent refresh once.
    const refreshed = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshed.ok) {
      const data = await refreshed.json();
      accessToken = data.accessToken;
      return request(path, { method, body, retry: false });
    }
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  teams: () => request('/teams'),
  createTeam: (payload) => request('/teams', { method: 'POST', body: payload }),
  teamMembers: (teamId) => request(`/teams/${teamId}/members`),
  addMember: (teamId, payload) => request(`/teams/${teamId}/members`, { method: 'POST', body: payload }),
  updateMemberRole: (teamId, userId, role) =>
    request(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (teamId, userId) => request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
  schedules: (teamId, month) => request(`/teams/${teamId}/schedules?month=${month}`),
  generateSchedule: (teamId, year, month, overwriteManual) =>
    request(`/teams/${teamId}/schedules/generate`, { method: 'POST', body: { year, month, overwriteManual } }),
  createSchedule: (teamId, userId, date) =>
    request(`/teams/${teamId}/schedules`, { method: 'POST', body: { userId, date } }),
  deleteSchedule: (teamId, scheduleId) =>
    request(`/teams/${teamId}/schedules/${scheduleId}`, { method: 'DELETE' }),
  triggerExport: (month, teamIds) => request('/exports/monthly', { method: 'POST', body: { month, teamIds } }),
  downloadMonthlyExport: async (month, teamIds) => {
    const response = await request('/exports/monthly', { method: 'POST', body: { month, teamIds } });
    const fileResponse = await fetch(response.downloadUrl, {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (!fileResponse.ok) {
      const data = await fileResponse.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (${fileResponse.status})`);
    }
    return {
      blob: await fileResponse.blob(),
      fileName: `oncall-export-${month}.xlsx`,
    };
  },
};
