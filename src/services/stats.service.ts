import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { NotFoundError, ForbiddenError } from '@/utils/errors';
import {
  addUtcDays,
  calculateBestStreak,
  calculateStreak,
  countScheduledDays,
  isScheduledOn,
  toDayKey,
  utcStartOfDay,
} from '@/utils/helpers';
import { HabitStats } from '@/types/habit.types';

/** Tamanho máximo da janela de aderência. A real pode ser menor — ver abaixo. */
const WINDOW_DAYS = 30;

export class StatsService {
  constructor(
    private checkinsRepository: CheckinsRepository,
    private habitsRepository: HabitsRepository
  ) {}

  /**
   * Estatística de um hábito. Determinística e sem qualquer dependência de IA —
   * é esta função que produz todo número que a camada de insights redige.
   *
   * Duas decisões que a versão anterior não tinha:
   *
   * 1. A aderência é medida contra os **dias agendados**, não contra o
   *    calendário. Antes o denominador era 30 fixo, então um hábito de três
   *    vezes por semana tinha teto de ~43% mesmo cumprido à risca.
   *
   * 2. A janela nunca começa antes da criação do hábito. Antes, um hábito criado
   *    ontem e cumprido aparecia com ~3% de aderência.
   */
  async getHabitStats(habitId: string, userId: string): Promise<HabitStats> {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    const scheduledDays = habit.scheduledDays ?? [];
    const checkins = await this.checkinsRepository.findByHabitId(habitId);
    const checkinDates = checkins.map((c) => c.date);

    const currentStreak = calculateStreak(checkinDates, scheduledDays);
    const bestStreak = calculateBestStreak(checkinDates, scheduledDays);

    const today = utcStartOfDay();
    const earliest = utcStartOfDay(habit.createdAt);
    const desiredStart = addUtcDays(today, -(WINDOW_DAYS - 1));
    const windowStart = earliest.getTime() > desiredStart.getTime() ? earliest : desiredStart;
    const windowDays = Math.floor((today.getTime() - windowStart.getTime()) / 86_400_000) + 1;

    const recentCheckins = await this.checkinsRepository.findByHabitIdAndDateRange(
      habitId,
      windowStart,
      today
    );

    // Dias distintos, porque a chave única é (habitId, date) mas o range pode
    // trazer o mesmo dia se o banco tiver sujeira anterior à constraint.
    const doneDays = new Set(recentCheckins.map((c) => toDayKey(c.date)));
    let completedInWindow = 0;
    let extraCheckins = 0;
    for (const key of doneDays) {
      const day = new Date(`${key}T00:00:00.000Z`);
      if (isScheduledOn(day, scheduledDays)) completedInWindow++;
      else extraCheckins++;
    }

    const scheduledDaysInWindow = countScheduledDays(windowStart, today, scheduledDays);
    const completionRate =
      scheduledDaysInWindow === 0
        ? 0
        : Math.round((completedInWindow / scheduledDaysInWindow) * 10_000) / 100;

    return {
      totalCheckins: checkins.length,
      currentStreak,
      bestStreak,
      completionRate,
      windowDays,
      scheduledDaysInWindow,
      completedInWindow,
      extraCheckins,
    };
  }
}
