import { useI18n, type Lang } from '../i18n';
import { addDays, allDayDate, dayOf, detailDate, shortDate, todayStr } from '../lib/date';

export { addDays, allDayDate, dayOf, todayStr };

export interface DateTimeParts {
  date: string;
  time: string;
}

/** Read the wall-clock parts that are stored in a TickTick-compatible date. */
export function dateTimeParts(dateStr: string | null | undefined, allDay = false): DateTimeParts {
  if (!dateStr) return { date: '', time: '' };
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(dateStr);
  if (!match) return { date: '', time: '' };
  return { date: match[1], time: allDay ? '' : (match[2] ?? '') };
}

export function timeOf(dateStr: string | null | undefined): string | null {
  return dateTimeParts(dateStr).time || null;
}

/** Return an ISO-like local value while preserving the user's calendar day. */
export function localDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    Number.isNaN(value.getTime()) ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  ) {
    return null;
  }
  const offset = -value.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date}T${time}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}${String(absolute % 60).padStart(2, '0')}`;
}

/** Compact task schedule label used by list rows and the task detail trigger. */
export function scheduleLabel(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
  isAllDay: boolean,
  lang: Lang = useI18n.getState().lang,
): string {
  const start = dateTimeParts(startDate, isAllDay);
  const end = dateTimeParts(dueDate, isAllDay);
  const startValue = start.date ? startDate : null;
  const endValue = end.date ? dueDate : null;
  if (!startValue && !endValue) return '';

  if (isAllDay) {
    if (startValue && endValue && start.date !== end.date) {
      return `${shortDate(start.date, lang)} → ${shortDate(end.date, lang)}`;
    }
    return detailDate(endValue ?? startValue!, lang);
  }

  const label = (value: string, parts: DateTimeParts) =>
    `${detailDate(value, lang)}${parts.time ? ` ${parts.time}` : ''}`;
  if (startValue && endValue) {
    // TickTick writes a point in time as start = due: show it once, not "17:00–17:00".
    if (start.date === end.date && start.time === end.time) return label(endValue, end);
    if (start.date === end.date && start.time && end.time) {
      return `${detailDate(startValue, lang)} ${start.time}–${end.time}`;
    }
    return `${label(startValue, start)} → ${label(endValue, end)}`;
  }
  return label((endValue ?? startValue)!, endValue ? end : start);
}

/** Return every calendar day touched by a task, capped for malformed imports. */
export function daysInRange(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
  maxDays = 366,
): string[] {
  const start = dayOf(startDate) ?? dayOf(dueDate);
  const end = dayOf(dueDate) ?? start;
  if (!start || !end) return [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return [end];
  const count = Math.min(Math.floor((endMs - startMs) / 86400000) + 1, maxDays);
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

/** Number of local calendar days from `from` to `to`. */
export function dayDistance(from: string, to: string): number | null {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

/** Shift a scheduled value to a new local calendar day, retaining its time. */
export function moveDateToDay(value: string | null | undefined, day: string, allDay: boolean): string | null {
  if (!value) return null;
  if (allDay) return allDayDate(day);
  const parts = dateTimeParts(value);
  return parts.time ? localDateTime(day, parts.time) : allDayDate(day);
}

interface Schedulable {
  projectId: string;
  startDate: string | null;
  dueDate: string | null;
  isAllDay: boolean;
}

/**
 * Update patch for TickTick's "postpone": the due day becomes `day`, the start
 * moves by the same number of days, and timed tasks keep their clock time.
 */
export function postponePatch(task: Schedulable, day: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    projectId: task.projectId,
    isAllDay: task.isAllDay,
    dueDate: moveDateToDay(task.dueDate, day, task.isAllDay),
  };
  const dueDay = dayOf(task.dueDate);
  const startDay = dayOf(task.startDate);
  const delta = dueDay ? dayDistance(dueDay, day) : null;
  if (startDay && delta != null) {
    patch.startDate = moveDateToDay(task.startDate, addDays(startDay, delta), task.isAllDay);
  }
  return patch;
}
