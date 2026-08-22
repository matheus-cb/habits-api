import { AdherenceReport, HabitAdherence } from '@/insights/adherence.types';

export function habitAdherence(over: Partial<HabitAdherence> = {}): HabitAdherence {
  return {
    habitId: 'habit-1',
    title: 'Correr',
    scheduledDays: [1, 3, 5],
    scheduledDaysInWindow: 12,
    completedInWindow: 8,
    extraCheckins: 1,
    completionRate: 66.67,
    currentStreak: 2,
    bestStreak: 5,
    weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 3 }],
    extrasByWeekday: [{ weekday: 6, hits: 1 }],
    streakAtRisk: false,
    ...over,
  };
}

export function adherenceReport(over: Partial<AdherenceReport> = {}): AdherenceReport {
  const habits = over.habits ?? [habitAdherence()];
  const avaliaveis = habits.filter((habit) => habit.scheduledDaysInWindow > 0);
  const ordenados = [...avaliaveis].sort(
    (a, b) => b.completionRate - a.completionRate || a.title.localeCompare(b.title)
  );

  return {
    windowDays: 30,
    windowStart: '2026-07-24',
    windowEnd: '2026-08-22',
    habitCount: habits.length,
    overallCompletionRate:
      avaliaveis.length === 0
        ? 0
        : Math.round(
            (avaliaveis.reduce((soma, habit) => soma + habit.completionRate, 0) /
              avaliaveis.length) *
              100
          ) / 100,
    habits,
    strongest: ordenados[0] ?? null,
    weakest: ordenados[ordenados.length - 1] ?? null,
    ...over,
  };
}
