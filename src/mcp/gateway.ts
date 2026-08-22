import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { CheckinsService } from '@/services/checkins.service';
import { HabitsService } from '@/services/habits.service';
import { StatsService } from '@/services/stats.service';
import { AdherenceService } from '@/insights/adherence.service';
import { AdherenceReport } from '@/insights/adherence.types';
import { HabitStats } from '@/types/habit.types';

/**
 * Porta de leitura do MCP — INV-17.
 *
 * A anotação `readOnlyHint` declara a intenção; **este tipo** é o que a torna
 * inalcançável. Nenhum método aqui escreve, então uma tool não tem por onde
 * criar hábito, marcar check-in ou apagar nada — nem por engano, nem por
 * refatoração distraída, nem por instrução injetada no argumento.
 *
 * É a mesma escolha do `IReadOnlyProductCatalog` do NotaFlow: se a defesa fosse
 * "as tools registradas não escrevem", ela dependeria de quem escrever a próxima
 * tool lembrar disso.
 */
export interface ReadOnlyHabitsGateway {
  listHabits(userId: string): Promise<HabitSummary[]>;
  getHabit(userId: string, habitId: string): Promise<HabitSummary>;
  getStats(userId: string, habitId: string): Promise<HabitStats>;
  listCheckins(userId: string, habitId: string, limit: number): Promise<CheckinSummary[]>;
  getAdherenceReport(userId: string): Promise<AdherenceReport>;
}

export interface HabitSummary {
  id: string;
  title: string;
  description: string | null;
  scheduledDays: number[];
  createdAt: string;
}

export interface CheckinSummary {
  id: string;
  date: string;
}

export class ServiceHabitsGateway implements ReadOnlyHabitsGateway {
  constructor(
    private habits: HabitsService,
    private checkins: CheckinsService,
    private stats: StatsService,
    private adherence: AdherenceService
  ) {}

  async listHabits(userId: string): Promise<HabitSummary[]> {
    const habits = await this.habits.getAllHabits(userId);
    return habits.map(toSummary);
  }

  async getHabit(userId: string, habitId: string): Promise<HabitSummary> {
    // `getHabitById` já aplica a checagem de dono (INV-03). O MCP não reimplementa
    // autorização — ele passa pelo mesmo service que a rota HTTP usa.
    return toSummary(await this.habits.getHabitById(habitId, userId));
  }

  async getStats(userId: string, habitId: string): Promise<HabitStats> {
    return this.stats.getHabitStats(habitId, userId);
  }

  async listCheckins(userId: string, habitId: string, limit: number): Promise<CheckinSummary[]> {
    const checkins = await this.checkins.getCheckinsByHabit(habitId, userId);
    return checkins.slice(0, limit).map((checkin) => ({
      id: checkin.id,
      date: checkin.date.toISOString().slice(0, 10),
    }));
  }

  async getAdherenceReport(userId: string): Promise<AdherenceReport> {
    return this.adherence.buildReport(userId);
  }
}

function toSummary(habit: {
  id: string;
  title: string;
  description: string | null;
  scheduledDays: number[];
  createdAt: Date;
}): HabitSummary {
  return {
    id: habit.id,
    title: habit.title,
    description: habit.description,
    scheduledDays: habit.scheduledDays ?? [],
    createdAt: habit.createdAt.toISOString(),
  };
}

/** Composição padrão. Existe para o teste poder injetar um gateway falso. */
export function createHabitsGateway(): ReadOnlyHabitsGateway {
  const habitsRepository = new HabitsRepository();
  const checkinsRepository = new CheckinsRepository();
  return new ServiceHabitsGateway(
    new HabitsService(habitsRepository),
    new CheckinsService(checkinsRepository, habitsRepository),
    new StatsService(checkinsRepository, habitsRepository),
    new AdherenceService(habitsRepository, checkinsRepository)
  );
}
