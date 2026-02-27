import { calculateStreak, formatDate, isSameDay, startOfDay } from '@/utils/helpers';

/** Build a Date at noon, N calendar days before today (local time). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// calculateStreak
// ---------------------------------------------------------------------------

describe('calculateStreak', () => {
  it('returns 0 for an empty array', () => {
    expect(calculateStreak([])).toBe(0);
  });

  it('returns 1 for a single checkin today', () => {
    expect(calculateStreak([daysAgo(0)])).toBe(1);
  });

  it('returns 1 for a single checkin yesterday', () => {
    expect(calculateStreak([daysAgo(1)])).toBe(1);
  });

  it('returns 0 when the most recent checkin is 2 days ago (streak broken)', () => {
    expect(calculateStreak([daysAgo(2)])).toBe(0);
  });

  it('returns 0 when checkins exist but all are older than yesterday', () => {
    expect(calculateStreak([daysAgo(5), daysAgo(6), daysAgo(7)])).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(calculateStreak([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3);
  });

  it('counts consecutive days ending yesterday', () => {
    expect(calculateStreak([daysAgo(1), daysAgo(2), daysAgo(3)])).toBe(3);
  });

  it('stops counting at a gap in the sequence', () => {
    // today + yesterday, then a gap (4 days ago skips 2 days)
    expect(calculateStreak([daysAgo(0), daysAgo(1), daysAgo(4)])).toBe(2);
  });

  it('handles unsorted input (oldest first) and sorts correctly', () => {
    expect(calculateStreak([daysAgo(2), daysAgo(0), daysAgo(1)])).toBe(3);
  });

  it('returns 7 for a full week of consecutive checkins ending today', () => {
    const week = Array.from({ length: 7 }, (_, i) => daysAgo(i));
    expect(calculateStreak(week)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a date to YYYY-MM-DD based on UTC', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(formatDate(date)).toBe('2024-06-15');
  });

  it('formats another date correctly', () => {
    const date = new Date('2023-12-01T00:00:00Z');
    expect(formatDate(date)).toBe('2023-12-01');
  });
});

// ---------------------------------------------------------------------------
// isSameDay
// ---------------------------------------------------------------------------

describe('isSameDay', () => {
  it('returns true for two dates on the same UTC day', () => {
    const d1 = new Date('2024-06-15T08:00:00Z');
    const d2 = new Date('2024-06-15T20:00:00Z');
    expect(isSameDay(d1, d2)).toBe(true);
  });

  it('returns false for dates on different UTC days', () => {
    const d1 = new Date('2024-06-15T12:00:00Z');
    const d2 = new Date('2024-06-16T12:00:00Z');
    expect(isSameDay(d1, d2)).toBe(false);
  });

  it('returns true for the exact same date object', () => {
    const d = new Date('2024-03-20T10:00:00Z');
    expect(isSameDay(d, d)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startOfDay
// ---------------------------------------------------------------------------

describe('startOfDay', () => {
  it('sets time to 00:00:00.000 in local time', () => {
    const date = new Date();
    date.setHours(14, 30, 45, 500);
    const result = startOfDay(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('does not mutate the original date', () => {
    const date = new Date();
    date.setHours(14, 30, 0, 0);
    const originalTime = date.getTime();
    startOfDay(date);
    expect(date.getTime()).toBe(originalTime);
  });

  it('preserves the calendar date (year/month/day)', () => {
    const date = new Date(2024, 5, 15, 14, 30, 0); // June 15, 2024 14:30 local
    const result = startOfDay(date);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(5); // June = index 5
    expect(result.getDate()).toBe(15);
  });

  it('defaults to the current calendar day when called without arguments', () => {
    const now = new Date();
    const result = startOfDay();
    expect(result.getFullYear()).toBe(now.getFullYear());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });
});
