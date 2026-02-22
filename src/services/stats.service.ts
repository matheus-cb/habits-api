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

    // Calculate best streak by iterating all historical check-ins
    let bestStreak = currentStreak;
    if (checkinDates.length > 1) {
      const sortedAsc = [...checkinDates]
        .map((d) => {
          const date = new Date(d);
          date.setHours(0, 0, 0, 0);
          return date;
        })
        .sort((a, b) => a.getTime() - b.getTime());

      let runningStreak = 1;
      for (let i = 1; i < sortedAsc.length; i++) {
        const diffMs = sortedAsc[i].getTime() - sortedAsc[i - 1].getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          runningStreak++;
          if (runningStreak > bestStreak) bestStreak = runningStreak;
        } else {
          runningStreak = 1;
        }
      }
    }

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
