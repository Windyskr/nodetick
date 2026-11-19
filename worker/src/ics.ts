type Row = Record<string, unknown>;

const basicUtc = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

// CR/CRLF too: a bare CR inside a content line is invalid RFC 5545.
const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n');

const day = (value: unknown): string | null => {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;
  return match ? match[1].replace(/-/g, '') : null;
};

/**
 * Render dated, active tasks as an RFC 5545 VCALENDAR. Shared by the session
 * one-shot /api/export/calendar.ics download and the secret-URL subscription
 * feed at /open/v1/feed.ics.
 */
export function buildIcsCalendar(rows: Row[]): string {
  const now = basicUtc(new Date().toISOString())!;
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NodeTick//Feed//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:NodeTick'];
  for (const r of rows) {
    const allDay = Number(r.is_all_day ?? 0) === 1;
    const dtStart = allDay ? day(r.start_date ?? r.due_date) : basicUtc(r.start_date ?? r.due_date);
    if (!dtStart) continue;
    let dtEnd = allDay ? day(r.due_date ?? r.start_date) : basicUtc(r.due_date);
    if (allDay && dtEnd) {
      // All-day DTEND is non-inclusive: advance it so the due day itself renders.
      const ms = Date.parse(`${dtEnd.slice(0, 4)}-${dtEnd.slice(4, 6)}-${dtEnd.slice(6, 8)}T00:00:00Z`) + 86400000;
      dtEnd = new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    }
    lines.push('BEGIN:VEVENT', `UID:${String(r.id)}@nodetick`, `DTSTAMP:${now}`);
    lines.push(allDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`);
    if (dtEnd && dtEnd > dtStart) lines.push(allDay ? `DTEND;VALUE=DATE:${dtEnd}` : `DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeText(String(r.title ?? ''))}`);
    // Truncate before escaping so the cut never splits an escape sequence.
    if (r.content) lines.push(`DESCRIPTION:${escapeText(String(r.content).slice(0, 900))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
