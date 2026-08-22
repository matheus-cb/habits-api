import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import {
  addUtcDays,
  calculateBestStreak,
  calculateStreak,
  countScheduledDays,
  isScheduledOn,
  toDayKey,
  utcStartOfDay,
  utcWeekday,
} from '@/utils/helpers';
import { AdherenceReport, HabitAdherence, WeekdayHit, WeekdayMiss } from './adherence.types';

const WINDOW_DAYS = 30;

/**
 * Cálculo de aderência. Determinístico, sem qualquer dependência de IA.
 *
 * Esta é a peça que sustenta INV-13: o relatório é produzido aqui, por contagem,
 * e o modelo de linguagem recebe o resultado já fechado. Nada nesta classe sabe
 * que existe um provedor de IA — de propósito. Se um dia a redação sair, este
 * arquivo continua respondendo o mesmo.
 */
export class AdherenceService {
  constructor(
    private habitsRepository: HabitsRepository,
    private checkinsRepository: CheckinsRepository
  ) {}

  async buildReport(userId: string): Promise<AdherenceReport> {
    const habits = await this.habitsRepository.findByUserId(userId);
    const today = utcStartOfDay();
    const windowStart = addUtcDays(today, -(WINDOW_DAYS - 1));

    if (habits.length === 0) {
      return {
        windowDays: WINDOW_DAYS,
        windowStart: toDayKey(windowStart),
        windowEnd: toDayKey(today),
        habitCount: 0,
        overallCompletionRate: 0,
        habits: [],
        strongest: null,
        weakest: null,
      };
    }

    const habitIds = habits.map((habit) => habit.id);
    const [windowCheckins, allCheckins] = await Promise.all([
      this.checkinsRepository.findByHabitIdsAndDateRange(habitIds, windowStart, today),
      this.checkinsRepository.findByHabitIds(habitIds),
    ]);

    const windowByHabit = groupDayKeys(windowCheckins);
    const allByHabit = groupDates(allCheckins);

    const detail = habits.map((habit) => {
      const scheduledDays = habit.scheduledDays ?? [];
      // A janela do hábito nunca começa antes de ele existir (INV-06).
      const createdAt = utcStartOfDay(habit.createdAt);
      const start = createdAt.getTime() > windowStart.getTime() ? createdAt : windowStart;
      const doneDays = windowByHabit.get(habit.id) ?? new Set<string>();

      let completedInWindow = 0;
      let extraCheckins = 0;
      for (const key of doneDays) {
        const day = new Date(`${key}T00:00:00.000Z`);
        if (day.getTime() < start.getTime()) continue;
        if (isScheduledOn(day, scheduledDays)) completedInWindow++;
        else extraCheckins++;
      }

      const scheduledDaysInWindow = countScheduledDays(start, today, scheduledDays);
      const completionRate =
        scheduledDaysInWindow === 0 ? 0 : round2((completedInWindow / scheduledDaysInWindow) * 100);

      const history = allByHabit.get(habit.id) ?? [];
      const currentStreak = calculateStreak(history, scheduledDays);

      return {
        habitId: habit.id,
        title: habit.title,
        scheduledDays,
        scheduledDaysInWindow,
        completedInWindow,
        extraCheckins,
        completionRate,
        currentStreak,
        bestStreak: calculateBestStreak(history, scheduledDays),
        weakestWeekdays: missesByWeekday(start, today, scheduledDays, doneDays),
        extrasByWeekday: extrasByWeekday(start, scheduledDays, doneDays),
        // Só está em risco quem tem sequência para perder e ainda não cumpriu hoje.
        streakAtRisk:
          currentStreak > 0 &&
          isScheduledOn(today, scheduledDays) &&
          !doneDays.has(toDayKey(today)),
      } satisfies HabitAdherence;
    });

    const avaliaveis = detail.filter((habit) => habit.scheduledDaysInWindow > 0);
    const overallCompletionRate =
      avaliaveis.length === 0
        ? 0
        : round2(
            avaliaveis.reduce((soma, habit) => soma + habit.completionRate, 0) / avaliaveis.length
          );

    // Empate resolvido pelo título, para que duas chamadas seguidas devolvam o
    // mesmo "mais forte" — determinismo vale também para o desempate.
    const ordenados = [...avaliaveis].sort(
      (a, b) => b.completionRate - a.completionRate || a.title.localeCompare(b.title)
    );

    return {
      windowDays: WINDOW_DAYS,
      windowStart: toDayKey(windowStart),
      windowEnd: toDayKey(today),
      habitCount: habits.length,
      overallCompletionRate,
      habits: detail,
      strongest: ordenados[0] ?? null,
      weakest: ordenados[ordenados.length - 1] ?? null,
    };
  }
}

/**
 * Falhas por dia da semana. É o insumo da sugestão de reagendamento: quem
 * agendou domingo e perdeu os quatro domingos da janela tem um sinal claro, e
 * ele sai de contagem, não de interpretação.
 */
function missesByWeekday(
  from: Date,
  to: Date,
  scheduledDays: number[],
  doneDays: Set<string>
): WeekdayMiss[] {
  const porDia = new Map<number, WeekdayMiss>();
  let cursor = utcStartOfDay(from);
  const last = utcStartOfDay(to);

  while (cursor.getTime() <= last.getTime()) {
    if (isScheduledOn(cursor, scheduledDays)) {
      const weekday = utcWeekday(cursor);
      const entrada = porDia.get(weekday) ?? { weekday, scheduled: 0, missed: 0 };
      entrada.scheduled++;
      if (!doneDays.has(toDayKey(cursor))) entrada.missed++;
      porDia.set(weekday, entrada);
    }
    cursor = addUtcDays(cursor, 1);
  }

  return [...porDia.values()]
    .filter((entrada) => entrada.missed > 0)
    .sort((a, b) => b.missed - a.missed || a.weekday - b.weekday);
}

/**
 * Onde caíram os check-ins que o agendamento não pedia, por dia da semana.
 *
 * Duas quartas cumpridas sem quarta estar agendada dizem mais sobre a rotina
 * real do que qualquer intenção declarada no cadastro.
 */
function extrasByWeekday(from: Date, scheduledDays: number[], doneDays: Set<string>): WeekdayHit[] {
  const porDia = new Map<number, number>();
  for (const key of doneDays) {
    const day = new Date(`${key}T00:00:00.000Z`);
    if (day.getTime() < from.getTime()) continue;
    if (isScheduledOn(day, scheduledDays)) continue;
    const weekday = utcWeekday(day);
    porDia.set(weekday, (porDia.get(weekday) ?? 0) + 1);
  }
  return [...porDia.entries()]
    .map(([weekday, hits]) => ({ weekday, hits }))
    .sort((a, b) => b.hits - a.hits || a.weekday - b.weekday);
}

function groupDayKeys(checkins: { habitId: string; date: Date }[]): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const checkin of checkins) {
    const set = mapa.get(checkin.habitId) ?? new Set<string>();
    set.add(toDayKey(checkin.date));
    mapa.set(checkin.habitId, set);
  }
  return mapa;
}

function groupDates(checkins: { habitId: string; date: Date }[]): Map<string, Date[]> {
  const mapa = new Map<string, Date[]>();
  for (const checkin of checkins) {
    const lista = mapa.get(checkin.habitId) ?? [];
    lista.push(checkin.date);
    mapa.set(checkin.habitId, lista);
  }
  return mapa;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
