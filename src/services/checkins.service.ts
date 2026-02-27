import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { NotFoundError, ForbiddenError, ConflictError } from '@/utils/errors';
import { startOfDay } from '@/utils/helpers';

export class CheckinsService {
  constructor(
    private checkinsRepository: CheckinsRepository,
    private habitsRepository: HabitsRepository
  ) {}

  async createCheckin(habitId: string, userId: string, date?: Date) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    const checkinDate = date ? startOfDay(new Date(date)) : startOfDay(new Date());

    // Check if check-in already exists for this date
    const existingCheckin = await this.checkinsRepository.findByHabitIdAndDate(
      habitId,
      checkinDate
    );

    if (existingCheckin) {
      throw new ConflictError('Check-in already exists for this date');
    }

    return this.checkinsRepository.create({
      habitId,
      date: checkinDate,
    });
  }

  async getCheckinsByHabit(
    habitId: string,
    userId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    if (startDate && endDate) {
      return this.checkinsRepository.findByHabitIdAndDateRange(habitId, startDate, endDate);
    }

    return this.checkinsRepository.findByHabitId(habitId);
  }

  async deleteCheckin(checkinId: string, habitId: string, userId: string) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    const checkin = await this.checkinsRepository.findById(checkinId);

    if (!checkin || checkin.habitId !== habitId) {
      throw new NotFoundError('Check-in');
    }

    await this.checkinsRepository.delete(checkinId);
  }
}
