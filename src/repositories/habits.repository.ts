import crypto from 'node:crypto';
import { prisma } from '@/config/database';
import { Habit } from '@prisma/client';

export class HabitsRepository {
  async findById(id: string): Promise<Habit | null> {
    // `findFirst` pelo mesmo motivo do checkins.repository: `findUnique` não
    // aceita o filtro de soft delete, e a extensão recusa em vez de converter.
    return prisma.habit.findFirst({
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
    createdVia?: 'user' | 'assistant';
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

  /**
   * Soft delete do hábito e dos check-ins ativos dele, com o MESMO timestamp.
   *
   * O timestamp compartilhado identifica o lote: sem ele, o restore
   * ressuscitaria também os check-ins que a pessoa havia desfeito antes, e ela
   * veria dias marcados que ela mesma tinha desmarcado.
   *
   * Em transação porque hábito escondido com check-ins visíveis é estado
   * inconsistente — e é o estado que ficaria se a segunda escrita falhasse.
   */
  async softDelete(id: string): Promise<string> {
    const deletedAt = new Date();
    const deleteBatchId = crypto.randomUUID();

    await prisma.$transaction([
      prisma.habit.update({ where: { id }, data: { deletedAt, deleteBatchId } }),
      prisma.checkin.updateMany({
        where: { habitId: id, deletedAt: null },
        data: { deletedAt, deleteBatchId },
      }),
    ]);

    return deleteBatchId;
  }

  /** Devolve o hábito e só os check-ins do lote apagado com ele. */
  async restore(id: string): Promise<Habit> {
    const apagado = await this.findByIdIncludingDeleted(id);
    if (!apagado?.deletedAt || !apagado.deleteBatchId) {
      // Restaurar o que não está apagado não é erro de dado — é pedido sem
      // efeito, e quem chama decide o status. O service transforma em 409.
      throw new Error('habito-nao-esta-apagado');
    }

    const [restaurado] = await prisma.$transaction([
      prisma.habit.update({ where: { id }, data: { deletedAt: null, deleteBatchId: null } }),
      // Pelo LOTE, não pelo timestamp: `deletedAt` é fato temporal e dois
      // deletes no mesmo milissegundo compartilhariam o valor, fazendo o restore
      // ressuscitar o que a pessoa havia desfeito de propósito.
      prisma.checkin.updateMany({
        where: { habitId: id, deleteBatchId: apagado.deleteBatchId },
        data: { deletedAt: null, deleteBatchId: null },
      }),
    ]);

    return restaurado;
  }

  /**
   * Alcança o apagado, de propósito e por um caminho nomeado.
   *
   * A extensão de soft delete filtra toda leitura, então restore e diagnóstico
   * precisam de uma porta explícita. Ela usa `$queryRaw` porque a extensão
   * intercepta as operações do client — e um método que "às vezes ignora o
   * filtro" seria pior que este, que declara no nome o que faz.
   *
   * Sem `::uuid` no parâmetro: `String @id @default(uuid())` do Prisma vira
   * coluna `text` no Postgres, não `uuid`. O cast comparava text com uuid e
   * estourava em runtime, com o restore devolvendo 500.
   */
  async findByIdIncludingDeleted(id: string): Promise<Habit | null> {
    const linhas = await prisma.$queryRaw<Habit[]>`
      SELECT * FROM "habits" WHERE "id" = ${id} LIMIT 1
    `;
    return linhas[0] ?? null;
  }
}
