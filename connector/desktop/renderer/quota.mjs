export function presentQuota(provider, now = Date.now()) {
  const windows = [];
  for (const [kind, shortLabel] of [['short', '5h'], ['weekly', '7d']]) {
    const value = provider?.quota?.[kind];
    if (value && Number.isFinite(value.remainingPercent) && value.remainingPercent >= 0 && value.remainingPercent <= 100) windows.push({ ...value, kind, shortLabel });
  }
  const age = now - Date.parse(provider?.quotaObservedAt ?? provider?.observedAt);
  return { windows, state: !windows.length ? 'unavailable' : !Number.isFinite(age) || age > 90000 ? 'stale' : 'fresh' };
}

export function formatResetTime(value, now = Date.now()) {
  const date = new Date(value), current = new Date(now);
  if (!Number.isFinite(date.getTime())) return '';
  const day = date.toDateString() === current.toDateString() ? '오늘' : `${date.getFullYear() !== current.getFullYear() ? `${date.getFullYear()}년 ` : ''}${date.getMonth()+1}월 ${date.getDate()}일`;
  return `${day} ${new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit',hour12:true}).format(date)}`;
}
