import { HabitsRepository } from '@/repositories/habits.repository';
import { NotFoundError, ForbiddenError } from '@/utils/errors';
import { CreateHabitInput, UpdateHabitInput } from '@/schemas/habits.schema';

export class HabitsService {
  constructor(private habitsRepository: HabitsRepository) {}

  async getAllHabits(userId: string) {
    return this.habitsRepository.findByUserId(userId);
  }

  async getHabitById(habitId: string, userId: string) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    return habit;
  }

  async createHabit(userId: string, data: CreateHabitInput) {
    return this.habitsRepository.create({
      ...data,
      userId,
    });
  }

  async updateHabit(habitId: string, userId: string, data: UpdateHabitInput) {
    const habit = await this.getHabitById(habitId, userId);

    return this.habitsRepository.update(habit.id, data);
  }

  async deleteHabit(habitId: string, userId: string) {
    const habit = await this.getHabitById(habitId, userId);

    await this.habitsRepository.delete(habit.id);
  }
}
