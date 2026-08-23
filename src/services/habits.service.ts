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

  async updateHabit(
    habitId: string,
    userId: string,
    data: UpdateHabitInput,
    changedVia: Origem = 'user'
  ) {
    const habit = await this.getHabitById(habitId, userId);

    return this.habitsRepository.update(habit.id, data, changedVia);
  }

  /**
   * O histórico de edições de um hábito.
   *
   * `getHabitById` primeiro, e não uma consulta direta em `habit_revisions`
   * filtrando por dono: a revisão não tem `userId` próprio de propósito, e o dono
   * é o do hábito. Consultar a revisão direto exigiria replicar a regra de posse
   * aqui — é INV-03 valendo por composição em vez de por repetição.
   */
  async getRevisions(habitId: string, userId: string) {
    const habit = await this.getHabitById(habitId, userId);
    const revisoes = await this.habitsRepository.findRevisions(habit.id);

    // `ordem` NÃO sai na resposta, e não é só porque `BigInt` não serializa em
    // JSON — o `res.json` estoura com `Do not know how to serialize a BigInt`, e
    // foi assim que descobri. O motivo de manter fora depois de descobrir é
    // outro: `ordem` é a chave de ordenação interna, e a informação que o cliente
    // precisa é a ORDEM DO ARRAY. Expor a coluna convidaria a interface a
    // reordenar por ela, criando um segundo lugar que decide a sequência.
    //
    // O backup do purge inclui `ordem`, e ali é o oposto: um backup que não
    // preserva a sequência não restaura o histórico.
    return revisoes.map(({ ordem: _ordem, ...revisao }) => revisao);
  }

  /**
   * Volta o hábito a uma versão anterior.
   *
   * O ponto que faz isto ser recuperação e não outra sobrescrita: restaurar
   * **também** grava revisão. Sem isso, desfazer uma edição destruiria o estado
   * de onde se desfez, e a segunda tentativa de voltar não teria para onde ir —
   * exatamente o defeito que esta tabela existe para fechar, reintroduzido pela
   * própria função que o fecha.
   *
   * Por isso o restore usa `update`, o mesmo caminho da edição, em vez de escrever
   * direto. Um segundo caminho de escrita seria um segundo lugar de onde esquecer
   * o snapshot.
   */
  async restoreRevision(habitId: string, revisionId: string, userId: string, via: Origem = 'user') {
    const habit = await this.getHabitById(habitId, userId);
    const revisao = await this.habitsRepository.findRevisionById(revisionId, habit.id);

    if (!revisao) {
      throw new NotFoundError('Revision');
    }

    return this.habitsRepository.update(
      habit.id,
      {
        title: revisao.title,
        description: revisao.description,
        scheduledDays: revisao.scheduledDays,
      },
      via
    );
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
