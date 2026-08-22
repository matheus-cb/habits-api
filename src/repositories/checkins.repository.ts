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

  /**
   * Check-ins de vários hábitos numa janela, em uma consulta.
   *
   * Existe para o relatório de aderência: com `findByHabitIdAndDateRange` num
   * laço, um usuário com 20 hábitos gerava 20 consultas por requisição. A porta
   * do banco continua sendo o repositório (INV-02) — o service só recebe o
   * resultado agrupado.
   */
  async findByHabitIdsAndDateRange(
    habitIds: string[],
    startDate: Date,
    endDate: Date
  ): Promise<Checkin[]> {
    if (habitIds.length === 0) return [];
    return prisma.checkin.findMany({
      where: {
        habitId: { in: habitIds },
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
    });
  }

  /** Todos os check-ins de vários hábitos, sem janela. Usado para o melhor streak. */
  async findByHabitIds(habitIds: string[]): Promise<Checkin[]> {
    if (habitIds.length === 0) return [];
    return prisma.checkin.findMany({
      where: { habitId: { in: habitIds } },
      orderBy: { date: 'desc' },
    });
  }
}
