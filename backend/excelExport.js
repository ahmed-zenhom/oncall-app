// excelExport.js — formats existing `schedules` rows into an .xlsx workbook.
// This module NEVER generates or randomizes assignments itself — it only
// reads what's already in the database, so exports are a pure reflection
// of current state (Section 5.1/5.4 of the design doc).

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function generateExcelExport(db, { month, teamIds, outputDir }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'On-Call Scheduling System';
  workbook.created = new Date();

  const monthPattern = `${month}-%`;

  const teams = teamIds && teamIds.length
    ? db.prepare(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`).all(...teamIds)
    : db.prepare(`SELECT * FROM teams`).all();

  for (const team of teams) {
    const sheet = workbook.addWorksheet(team.name.slice(0, 31)); // Excel sheet name limit

    sheet.columns = [
      { header: 'Member Name', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'On-Call Days (this month)', key: 'days', width: 60 },
      { header: 'Total Days', key: 'total', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const members = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN team_memberships tm ON tm.user_id = u.id
         WHERE tm.team_id = ? AND u.is_active = 1
         ORDER BY u.full_name`
      )
      .all(team.id);

    for (const member of members) {
      const rows = db
        .prepare(
          `SELECT on_call_date, assignment_type FROM schedules
           WHERE team_id = ? AND user_id = ? AND on_call_date LIKE ?
           ORDER BY on_call_date`
        )
        .all(team.id, member.id, monthPattern);

      const formatted = rows
        .map((r) => {
          const d = new Date(r.on_call_date + 'T00:00:00Z');
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
          return r.assignment_type === 'AUTO_WEEKEND' ? `${label} (wknd)` : label;
        })
        .join(', ');

      const row = sheet.addRow({
        name: member.full_name,
        email: member.email,
        days: formatted,
        total: rows.length,
      });

      // Flag any member who doesn't have exactly 10 days assigned yet,
      // so HR/admins notice incomplete schedules at a glance.
      if (rows.length !== 10) {
        row.getCell('total').font = { color: { argb: 'FFB91C1C' }, bold: true };
      }
    }
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `oncall-export-${month}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { generateExcelExport };
