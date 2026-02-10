/**
 * Calculate the current streak for a habit based on check-ins
 */
export function calculateStreak(checkins: Date[]): number {
  if (checkins.length === 0) return 0;

  // Sort dates in descending order (most recent first)
  const sortedDates = checkins
    .map((date) => new Date(date))
    .sort((a, b) => b.getTime() - a.getTime());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if most recent check-in is today or yesterday
  const mostRecent = sortedDates[0];
  mostRecent.setHours(0, 0, 0, 0);

  if (mostRecent.getTime() !== today.getTime() && mostRecent.getTime() !== yesterday.getTime()) {
    return 0; // Streak broken
  }

  let streak = 1;
  let currentDate = new Date(mostRecent);

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);

    const checkinDate = sortedDates[i];
    checkinDate.setHours(0, 0, 0, 0);

    if (checkinDate.getTime() === prevDate.getTime()) {
      streak++;
      currentDate = checkinDate;
    } else {
      break; // Streak broken
    }
  }

  return streak;
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return formatDate(date1) === formatDate(date2);
}

/**
 * Get start of day (00:00:00)
 */
export function startOfDay(date: Date = new Date()): Date {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
}
