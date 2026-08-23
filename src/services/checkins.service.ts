import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { NotFoundError, ForbiddenError, ConflictError } from '@/utils/errors';
import { utcStartOfDay } from '@/utils/helpers';

export class CheckinsService {
  constructor(
    private checkinsRepository: CheckinsRepository,
    private habitsRepository: HabitsRepository
  ) {}

  async createCheckin(
    habitId: string,
    userId: string,
    date?: Date,
    createdVia: 'user' | 'assistant' = 'user'
  ) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }

    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    // O dia é sempre resolvido em UTC, igual à coluna `@db.Date`. Com
    // meia-noite local, em fuso à frente de UTC o check-in caía no dia anterior.
    const checkinDate = utcStartOfDay(date ? new Date(date) : new Date());

    // Check-in em dia NÃO agendado é aceito de propósito: fazer a mais nunca é
    // erro. Ele não conta para a aderência nem emenda sequência — ver
    // StatsService, campo `extraCheckins`.

    // A checagem abaixo é conveniência para devolver 409 com mensagem em vez de
    // um erro de constraint. A garantia de um check-in por dia é do banco,
    // @@unique([habitId, date]) — não desta consulta, que corre em transação
    // separada e perde para dois pedidos simultâneos.
    const existingCheckin = await this.checkinsRepository.findByHabitIdAndDate(
      habitId,
      checkinDate
    );

    if (existingCheckin) {
      throw new ConflictError('Check-in already exists for this date');
    }

    try {
      return await this.checkinsRepository.create({
        habitId,
        date: checkinDate,
        createdVia,
      });
    } catch (error) {
      // Dois pedidos simultâneos passam os dois pela consulta acima e um perde
      // na constraint. Sem esta tradução o vencedor recebia 201 e o perdedor
      // 500 — mesmo caso de negócio, resposta diferente por acidente de tempo.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictError('Check-in already exists for this date');
      }
      throw error;
    }
  }

  async getCheckinsByHabit(habitId: string, userId: string, startDate?: Date, endDate?: Date) {
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

    await this.checkinsRepository.softDelete(checkinId);
  }

  /**
   * Restaura check-in desfeito.
   *
   * Pode colidir com o índice único parcial: se a pessoa desfez e marcou de novo
   * no mesmo dia, restaurar o antigo criaria dois ativos naquele dia. O banco
   * recusa, e a tradução é 409 — o mesmo status da duplicata, porque é a mesma
   * regra (INV-01).
   */
  async restoreCheckin(checkinId: string, habitId: string, userId: string) {
    const habit = await this.habitsRepository.findById(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }
    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    const checkin = await this.checkinsRepository.findByIdIncludingDeleted(checkinId);

    if (!checkin || checkin.habitId !== habitId) {
      throw new NotFoundError('Check-in');
    }
    if (!checkin.deletedAt) {
      throw new ConflictError('Este check-in não está desfeito');
    }

    try {
      return await this.checkinsRepository.restore(checkinId);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictError(
          'Já existe um check-in ativo nesse dia. Desfaça o atual antes de restaurar este.'
        );
      }
      throw error;
    }
  }
}

/**
 * P2002 é o código do Prisma para violação de constraint única. Checar o código,
 * e não a classe, mantém o service livre de import do Prisma — INV do
 * repositório como única porta do banco.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
