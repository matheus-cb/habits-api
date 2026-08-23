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
    // `findFirst`, não `findUnique`: só ele aceita o filtro de soft delete que a
    // extensão injeta. Ver `src/config/soft-delete.ts`.
    return prisma.checkin.findFirst({
      where: { id },
    });
  }

  async findByHabitIdAndDate(habitId: string, date: Date): Promise<Checkin | null> {
    // Era `findUnique({ where: { habitId_date: … } })`. Esse input composto
    // deixou de existir junto com o `@@unique` do modelo — a unicidade agora vive
    // num índice PARCIAL, que o Prisma não declara. `findFirst` com os dois
    // campos consulta o mesmo índice e recebe o filtro de soft delete.
    return prisma.checkin.findFirst({
      where: { habitId, date },
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

  async create(data: {
    habitId: string;
    date: Date;
    createdVia?: 'user' | 'assistant';
  }): Promise<Checkin> {
    return prisma.checkin.create({
      data,
    });
  }

  /** Soft delete: desfazer check-in passa a ser reversível. */
  async softDelete(id: string): Promise<void> {
    await prisma.checkin.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Checkin> {
    return prisma.checkin.update({ where: { id }, data: { deletedAt: null } });
  }

  /** Porta explícita para o apagado — ver o método equivalente em habits. */
  async findByIdIncludingDeleted(id: string): Promise<Checkin | null> {
    const linhas = await prisma.$queryRaw<Checkin[]>`
      SELECT * FROM "checkins" WHERE "id" = ${id} LIMIT 1
    `;
    return linhas[0] ?? null;
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
