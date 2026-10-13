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
  const yearStart = new Date(Date.UTC(year,0,1,12));
  const week = Math.ceil(((d.getTime()-yearStart.getTime())/86400000+1)/7);
  return year + '-W' + String(week).padStart(2,'0');
}

/**
 * Compute the earliest permitted reminder instant. A skipped evening/weekend
 * check is NOT a delivered reminder and must not consume the cooldown.
 * Quarter-hour UTC candidates also support half-hour and 45-minute timezones.
 */
export function nextReminderAt(earliest: Date, policy: WorkingPolicy): Date {
  if (!hasReminderPolicy(policy)) throw new Error('Reminder policy is not configured');
  if (canSendReminder(earliest, policy)) return earliest;
  const quantum = 15 * 60 * 1000;
  const start = Math.ceil(earliest.getTime() / quantum) * quantum;
  for (let n = 0; n < 15 * 24 * 4; n++) {
    const candidate = new Date(start + n * quantum);
    if (canSendReminder(candidate, policy)) return candidate;
  }
  throw new Error('No eligible reminder time within 15 days');
}

/** Risk-aware, bounded follow-up cadence. Date strings are project-local YYYY-MM-DD. */
export function followupIntervalDays(dueDate:string,today:string,status:string):number{
  const remaining=Math.round((Date.parse(dueDate+'T12:00:00Z')-
    Date.parse(today+'T12:00:00Z'))/86400000);
  if(!Number.isFinite(remaining))throw new Error('Invalid project-local due date');
  if(status==='blocked'||remaining<=3)return 1;
  if(remaining<=7)return 2;
  if(remaining<=14)return 3;
  return 7;
}
