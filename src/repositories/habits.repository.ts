import { prisma } from '@/config/database';
import { Habit } from '@prisma/client';

export class HabitsRepository {
  async findById(id: string): Promise<Habit | null> {
    return prisma.habit.findUnique({
      where: { id },
    });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Habit | null> {
    return prisma.habit.findFirst({
      where: { id, userId },
    });
  }

  async findByUserId(userId: string): Promise<Habit[]> {
    return prisma.habit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    title: string;
    description?: string;
    userId: string;
    scheduledDays?: number[];
  }): Promise<Habit> {
    return prisma.habit.create({
      data,
    });
  }

  async update(
    id: string,
    data: { title?: string; description?: string | null; scheduledDays?: number[] }
  ): Promise<Habit> {
    return prisma.habit.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.habit.delete({
      where: { id },
    });
  }
}
