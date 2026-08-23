import crypto from 'node:crypto';
import { prisma } from '@/config/database';
import { Habit, HabitRevision } from '@prisma/client';

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

  /**
   * Edita o hábito e grava a versão ANTERIOR, na mesma transação.
   *
   * A transação não é zelo: sem ela existem dois estados intermediários ruins, e
   * o segundo é pior que perder a edição. Se a revisão gravar e o update falhar,
   * o histórico ganha uma versão que nunca foi substituída — e a linha mais
   * recente de `habit_revisions` deixa de significar "o que havia antes da última
   * edição". Se o update passar e a revisão falhar, volta a assimetria que esta
   * tabela existe para fechar, silenciosamente e só naquele hábito.
   *
   * `anterior` vem de dentro da transação, e não do service, para o snapshot ser
   * do estado que está sendo substituído e não de uma leitura anterior — entre
   * uma leitura no service e o update aqui cabe outra edição.
   */
  async update(
    id: string,
    data: { title?: string; description?: string | null; scheduledDays?: number[] },
    changedVia: 'user' | 'assistant' = 'user'
  ): Promise<Habit> {
    return prisma.$transaction(async (tx) => {
      const anterior = await tx.habit.findFirst({ where: { id } });

      if (!anterior) {
        // O service já validou dono e existência; chegar aqui sem linha significa
        // exclusão concorrente. Deixar o `update` estourar dá o erro do Prisma,
        // que o middleware traduz — e não uma revisão de um hábito que não existe.
        return tx.habit.update({ where: { id }, data });
      }

      await tx.habitRevision.create({
        data: {
          habitId: id,
          title: anterior.title,
          description: anterior.description,
          scheduledDays: anterior.scheduledDays,
          changedVia,
        },
      });

      return tx.habit.update({ where: { id }, data });
    });
  }

  /**
   * Da mais recente para a mais antiga: a primeira é o que havia antes da última
   * edição.
   *
   * Ordena por `ordem`, não por `replacedAt`. O timestamp tem precisão de
   * milissegundo e empata — e histórico é lido por ORDEM, então um empate não
   * perde dado, perde a sequência, e a sequência errada parece completa.
   */
  async findRevisions(habitId: string): Promise<HabitRevision[]> {
    return prisma.habitRevision.findMany({
      where: { habitId },
      orderBy: { ordem: 'desc' },
    });
  }

  async findRevisionById(id: string, habitId: string): Promise<HabitRevision | null> {
    return prisma.habitRevision.findFirst({ where: { id, habitId } });
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
