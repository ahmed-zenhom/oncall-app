// scheduleGenerator.js — implements the business rule from the design doc
// (Section 5.3): every member gets exactly 10 on-call days per month,
// covering the first 4 chronological weekends (Fri+Sat = 8 days) when
// available, topped up with 2 random weekdays; if a month has fewer than
// 8 total weekend days, all weekend days are used and the remainder is
// filled with random weekdays.

const { randomUUID } = require('node:crypto');

// Simple seeded PRNG (mulberry32) so a given seed always reproduces the
// same "random" weekday selection — required for the export to be
// reproducible against a fixed DB state (Section 5.1 of the design doc).
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function getAllDatesInMonth(year, month /* 1-12 */) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(new Date(Date.UTC(year, month - 1, d)));
  }
  return dates;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// JS getUTCDay(): 0=Sun,1=Mon,...,5=Fri,6=Sat. The business rule defines
// "weekend" as Friday + Saturday specifically (not Sat/Sun).
function isWeekendDay(d) {
  const day = d.getUTCDay();
  return day === 5 || day === 6;
}

function sampleWithoutReplacement(arr, n, rng) {
  const pool = [...arr];
  const result = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

/**
 * Computes the set of on-call dates for ONE member for a given month.
 * Pure function — no DB access — so it's easy to unit test.
 *
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} memberSeedKey unique per-member string mixed into the seed
 *                                so members don't all get identical weekday picks
 * @param {string} runSeed the generation run's stored seed (for reproducibility)
 * @returns {{date: string, type: 'AUTO_WEEKEND'|'AUTO_WEEKDAY'}[]}
 */
function computeMemberAssignments(year, month, memberSeedKey, runSeed) {
  const allDays = getAllDatesInMonth(year, month);
  const weekendDays = allDays.filter(isWeekendDay).sort((a, b) => a - b);
  const weekdayDays = allDays.filter((d) => !isWeekendDay(d));

  const rng = mulberry32(seedFromString(`${runSeed}:${memberSeedKey}`));

  let chosenWeekends;
  let remainingSlots;

  if (weekendDays.length >= 8) {
    // Max whole weekends that fit inside a 10-day budget = 4 weekends (8 days),
    // leaving exactly 2 slots for weekdays. Only the first 4 chronological
    // weekends are used if the month has more than 4.
    chosenWeekends = weekendDays.slice(0, 8);
    remainingSlots = 10 - chosenWeekends.length; // = 2
  } else {
    // Fewer than 8 weekend days this month: use them all, fill the rest randomly.
    chosenWeekends = weekendDays;
    remainingSlots = 10 - chosenWeekends.length;
  }

  const chosenWeekdays = sampleWithoutReplacement(weekdayDays, remainingSlots, rng);

  const assignments = [
    ...chosenWeekends.map((d) => ({ date: toISODate(d), type: 'AUTO_WEEKEND' })),
    ...chosenWeekdays.map((d) => ({ date: toISODate(d), type: 'AUTO_WEEKDAY' })),
  ];

  return assignments.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Generates and persists a full month's schedule for every active member
 * of a team. Overwrites any existing AUTO_* rows for that team/month
 * (manual entries are left untouched unless `overwriteManual` is true).
 */
function generateMonthlySchedule(db, { teamId, year, month, triggeredBy, overwriteManual = false }) {
  const runSeed = randomUUID();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const members = db
    .prepare(
      `SELECT u.* FROM users u
       JOIN team_memberships tm ON tm.user_id = u.id
       WHERE tm.team_id = ? AND u.is_active = 1`
    )
    .all(teamId);

  const deleteStmt = overwriteManual
    ? db.prepare(`DELETE FROM schedules WHERE team_id = ? AND user_id = ? AND on_call_date LIKE ?`)
    : db.prepare(
        `DELETE FROM schedules WHERE team_id = ? AND user_id = ? AND on_call_date LIKE ? AND assignment_type != 'MANUAL'`
      );

  const insertStmt = db.prepare(
    `INSERT INTO schedules (id, team_id, user_id, on_call_date, assignment_type, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const monthPattern = `${monthStr}-%`;

  const tx = db.transaction(() => {
    for (const member of members) {
      deleteStmt.run(teamId, member.id, monthPattern);
      const assignments = computeMemberAssignments(year, month, member.id, runSeed);
      for (const a of assignments) {
        // Skip if a manual entry already occupies this exact date (only relevant
        // when overwriteManual is false, since manual rows weren't deleted above).
        const exists = db
          .prepare(`SELECT 1 FROM schedules WHERE team_id = ? AND user_id = ? AND on_call_date = ?`)
          .get(teamId, member.id, a.date);
        if (!exists) {
          insertStmt.run(randomUUID(), teamId, member.id, a.date, a.type, triggeredBy);
        }
      }
    }

    db.prepare(
      `INSERT INTO schedule_generation_runs (id, team_id, month, triggered_by, random_seed, status)
       VALUES (?, ?, ?, ?, ?, 'SUCCESS')`
    ).run(randomUUID(), teamId, monthStr, triggeredBy, runSeed);
  });

  tx();

  return { runSeed, memberCount: members.length };
}

module.exports = {
  computeMemberAssignments,
  generateMonthlySchedule,
  isWeekendDay,
  getAllDatesInMonth,
};
