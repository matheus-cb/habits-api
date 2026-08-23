import { HabitsRepository } from '@/repositories/habits.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '@/utils/errors';
import { CreateHabitInput, UpdateHabitInput } from '@/schemas/habits.schema';

/** Quem produziu o registro. A definição e o porquê vivem em `mcp/origem.ts`. */
export type Origem = 'user' | 'assistant';

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

  /**
   * `createdVia` vem de QUEM CHAMA no servidor, nunca do corpo da requisição.
   *
   * Se viesse do corpo, o assistente poderia declarar-se `user` e o histórico
   * perderia a única marca que o distingue. É o mesmo princípio de INV-10 — a
   * identidade não vem do que o cliente afirma — aplicado à origem do registro.
   */
  async createHabit(userId: string, data: CreateHabitInput, createdVia: Origem = 'user') {
    return this.habitsRepository.create({
      ...data,
      userId,
      createdVia,
    });
  }

  async updateHabit(habitId: string, userId: string, data: UpdateHabitInput) {
    const habit = await this.getHabitById(habitId, userId);

    return this.habitsRepository.update(habit.id, data);
  }

  /**
   * Apaga logicamente. O físico não existe por HTTP — é o script `npm run purge`.
   *
   * A escolha é estrutural, não de política: o delete real destrói todo o
   * histórico de check-ins por cascade, e o histórico é o valor inteiro do app.
   * Deixando-o fora da superfície HTTP, nenhum allowlist de assistente pode
   * expô-lo por engano — não há rota para expor.
   */
  async deleteHabit(habitId: string, userId: string) {
    const habit = await this.getHabitById(habitId, userId);

    await this.habitsRepository.softDelete(habit.id);
  }

  /**
   * Restaura hábito apagado logicamente, e só os check-ins do lote dele.
   *
   * A checagem de dono é feita sobre o registro APAGADO, por caminho explícito:
   * o `getHabitById` não o encontraria, porque a extensão de soft delete filtra.
   */
  async restoreHabit(habitId: string, userId: string) {
    const habit = await this.habitsRepository.findByIdIncludingDeleted(habitId);

    if (!habit) {
      throw new NotFoundError('Habit');
    }
    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }
    if (!habit.deletedAt) {
      throw new ConflictError('Este hábito não está apagado');
    }

    return this.habitsRepository.restore(habit.id);
  }
}
