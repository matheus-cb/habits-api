import { prisma } from '@/config/database';
import { Checkin } from '@prisma/client';

export class CheckinsRepository {
  async findByHabitId(habitId: string): Promise<Checkin[]> {
    return prisma.checkin.findMany({
      where: { habitId },
      orderBy: { date: 'desc' },
    });
  }

  async findById(id: string): Promise<Checkin | null> {
    return prisma.checkin.findUnique({
      where: { id },
    });
  }

  async findByHabitIdAndDate(habitId: string, date: Date): Promise<Checkin | null> {
    return prisma.checkin.findUnique({
      where: {
        habitId_date: {
          habitId,
          date,
        },
      },
    });
  }

  async findByHabitIdAndDateRange(
    habitId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Checkin[]> {
    return prisma.checkin.findMany({
      where: {
        habitId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async create(data: { habitId: string; date: Date }): Promise<Checkin> {
    return prisma.checkin.create({
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.checkin.delete({
      where: { id },
    });
  }

  async countByHabitId(habitId: string): Promise<number> {
    return prisma.checkin.count({
      where: { habitId },
    });
  }
}
