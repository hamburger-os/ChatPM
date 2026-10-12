import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSendReminder, periodKey, isValidTimezone } from '../src/policy.ts';
import { hashPassword, verifyPassword } from '../src/security.ts';

test('time zone validation and silent-by-default reminder', () => {
  assert.equal(isValidTimezone('Asia/Shanghai'),true);
  assert.equal(isValidTimezone('Missing/Country'),false);
  const p = { timezone:'Asia/Shanghai',work_start:null,work_end:null,cooldown_hours:null };
  assert.equal(canSendReminder(new Date('2026-10-12T02:00:00Z'),p),false);
});
test('reminders respect weekday and configured local hours', () => {
  const p = {timezone:'Asia/Shanghai',work_start:9,work_end:18,cooldown_hours:24};
  assert.equal(canSendReminder(new Date('2026-10-12T02:00:00Z'),p),true);
  assert.equal(canSendReminder(new Date('2026-10-12T13:00:00Z'),p),false);
  assert.equal(canSendReminder(new Date('2026-10-11T02:00:00Z'),p),false);
});
test('period grouping is timezone-aware at the month boundary', () => {
  assert.equal(periodKey(new Date('2026-09-30T17:00:00Z'),'Asia/Shanghai','month'),'2026-10');
  assert.equal(periodKey(new Date('2026-10-12T01:00:00Z'),'Asia/Shanghai','week'),'2026-W42');
});
test('password hashing uses random salt and resists bad passwords', () => {
  const a=hashPassword('test-safe-password');
  const b=hashPassword('test-safe-password');
  assert.notEqual(a,b);
  assert.equal(verifyPassword('test-safe-password',a),true);
  assert.equal(verifyPassword('wrong',a),false);
});
