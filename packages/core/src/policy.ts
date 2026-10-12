export type WorkingPolicy = {
  timezone: string;
  work_start: number | null;
  work_end: number | null;
  cooldown_hours: number | null;
};

export function isValidTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}
export function hasReminderPolicy(p: WorkingPolicy) {
  return isValidTimezone(p.timezone) &&
    p.work_start != null && p.work_end != null && p.cooldown_hours != null &&
    p.work_start >= 0 && p.work_end <= 24 && p.work_start < p.work_end &&
    p.cooldown_hours >= 1;
}
export function localClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? '';
  return { date: [part('year'),part('month'),part('day')].join('-'),
    weekday: part('weekday'), hour: Number(part('hour')) };
}
export function canSendReminder(date: Date, policy: WorkingPolicy) {
  if (!hasReminderPolicy(policy)) return false;
  const clock = localClock(date, policy.timezone);
  return !['Sat','Sun'].includes(clock.weekday) &&
    clock.hour >= policy.work_start! && clock.hour < policy.work_end!;
}
export function periodKey(date: Date, timezone: string, kind: 'week'|'month') {
  const datePart = localClock(date, timezone).date;
  if (kind === 'month') return datePart.slice(0,7);
  const d = new Date(datePart + 'T12:00:00Z');
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year,0,4,12));
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return year + '-W' + String(week).padStart(2,'0');
}
