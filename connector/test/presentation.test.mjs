import test from 'node:test';
import assert from 'node:assert/strict';
import { presentQuota, formatResetTime } from '../desktop/renderer/quota.mjs';

test('quota presentation shows supplied windows only, without inventing five-hour data', () => {
  const value = presentQuota({ observedAt: new Date(1000).toISOString(), quota: { short: null, weekly: { label: '7일 한도', remainingPercent: 73, resetsAt: null } } }, 2000);
  assert.equal(value.state, 'fresh'); assert.equal(value.windows.length, 1); assert.equal(value.windows[0].shortLabel, '7d');
  assert.equal(presentQuota({ observedAt: new Date(1000).toISOString(), quota: null }, 2000).state, 'unavailable');
});

test('quota observation older than 90 seconds is previous data', () => {
  const value = presentQuota({ observedAt: new Date(1000).toISOString(), quota: { short: { label: '5시간 한도', remainingPercent: 0, resetsAt: null }, weekly: null } }, 92000);
  assert.equal(value.state, 'stale'); assert.equal(value.windows[0].remainingPercent, 0);
});

test('quota freshness uses its own observation rather than newer catalog/auth time', () => {
  const value = presentQuota({ observedAt: new Date(100000).toISOString(), quotaObservedAt: new Date(1000).toISOString(), quota: { weekly: { label: '7일 한도', remainingPercent: 73, resetsAt: null } } }, 101000);
  assert.equal(value.state, 'stale');
});

test('quota reset time omits seconds and redundant year', () => {
  const now = new Date(2026,9,17,12,0).getTime();
  const today = formatResetTime(new Date(2026,9,17,18,0,59).toISOString(), now);
  assert.match(today, /^오늘 .*6:00$/); assert.equal(today.includes('59'),false);
  const later = formatResetTime(new Date(2026,9,22,16,43,30).toISOString(), now);
  assert.match(later,/^10월 22일 .*4:43$/); assert.equal(later.includes('2026'),false);
  assert.equal(formatResetTime('invalid',now),'');
});
