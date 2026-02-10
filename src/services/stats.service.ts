import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { NotFoundError, ForbiddenError } from '@/utils/errors';
import { calculateStreak } from '@/utils/helpers';
import { HabitStats } from '@/types/habit.types';

export class StatsService {
  constructor(
    private checkinsRepository: CheckinsRepository,
    private habitsRepository: HabitsRepository
  ) {}

  async getHabitStats(habitId: string, userId: string): Promise<HabitStats> {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    const checkins = await this.checkinsRepository.findByHabitId(habitId);
    const checkinDates = checkins.map((c) => c.date);

    // Calculate current streak
    const currentStreak = calculateStreak(checkinDates);

    // Calculate best streak (simplified - could be optimized)
    let bestStreak = currentStreak;
    // For now, best streak is same as current (can be improved with historical data)

    // Calculate completion rate for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCheckins = await this.checkinsRepository.findByHabitIdAndDateRange(
      habitId,
      thirtyDaysAgo,
      new Date()
    );

    const completionRate = (recentCheckins.length / 30) * 100;

    return {
      totalCheckins: checkins.length,
      currentStreak,
      bestStreak,
      completionRate: Math.round(completionRate * 100) / 100, // Round to 2 decimals
    };
  }
}
