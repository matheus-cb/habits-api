import { StatsService } from '@/services/stats.service';
import { addUtcDays, utcStartOfDay, utcWeekday } from '@/utils/helpers';

const mockCheckinsRepository = {
  findByHabitId: jest.fn(),
  findByHabitIdAndDateRange: jest.fn(),
};

const mockHabitsRepository = {
  findById: jest.fn(),
};

const statsService = new StatsService(
  mockCheckinsRepository as never,
  mockHabitsRepository as never
);

const HABIT_ID = 'habit-uuid-1';
const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';

/**
 * O hábito de referência nasceu há muito tempo. Isso importa: a janela nunca
 * começa antes da criação (INV-06), então um hábito criado hoje teria janela de
 * um dia e nenhum destes testes diria o que pretende dizer.
 */
const mockHabit = {
  id: HABIT_ID,
  userId: USER_ID,
  title: 'Test Habit',
  description: null,
  scheduledDays: [] as number[],
  createdAt: addUtcDays(utcStartOfDay(), -400),
  updatedAt: new Date(),
};

function utcDaysAgo(n: number): Date {
  return addUtcDays(utcStartOfDay(), -n);
}

function makeCheckin(id: string, offsetDays: number) {
  return { id, habitId: HABIT_ID, date: utcDaysAgo(offsetDays), createdAt: new Date() };
}

/** Os N dias mais recentes que caem em `weekday`, dentro dos últimos 30. */
function diasDaSemanaNaJanela(weekday: number): Date[] {
  const dias: Date[] = [];
  for (let offset = 0; offset < 30; offset++) {
    const dia = utcDaysAgo(offset);
    if (utcWeekday(dia) === weekday) dias.push(dia);
  }
  return dias;
}

function arrange(habit: Partial<typeof mockHabit>, todos: unknown[], naJanela: unknown[]) {
  mockHabitsRepository.findById.mockResolvedValueOnce({ ...mockHabit, ...habit });
  mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(todos);
  mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(naJanela);
}

describe('INV-03 — hábito só é legível pelo dono', () => {
  it('INV-03: hábito inexistente responde 404, não 403 nem 500', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce(null);

    await expect(statsService.getHabitStats(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Habit not found',
    });
  });

  it('INV-03: adversário — pedir estatística de hábito de outro dono responde 403', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce({ ...mockHabit, userId: OTHER_USER_ID });

    await expect(statsService.getHabitStats(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('INV-03: adversário — a checagem de dono vem antes de qualquer leitura de check-in', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce({ ...mockHabit, userId: OTHER_USER_ID });

    await expect(statsService.getHabitStats(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
    // Se a ordem se invertesse, dados de outra pessoa seriam lidos antes de o
    // 403 ser lançado — e apareceriam em log ou em métrica.
    expect(mockCheckinsRepository.findByHabitId).not.toHaveBeenCalled();
    expect(mockCheckinsRepository.findByHabitIdAndDateRange).not.toHaveBeenCalled();
  });
});

describe('INV-06 — aderência é medida contra dias agendados', () => {
  it('INV-06: hábito sem check-in nenhum devolve tudo zerado', async () => {
    arrange({}, [], []);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats).toMatchObject({
      totalCheckins: 0,
      currentStreak: 0,
      bestStreak: 0,
      completionRate: 0,
      completedInWindow: 0,
      extraCheckins: 0,
    });
  });

  it('INV-06: hábito diário mede contra os 30 dias da janela', async () => {
    const naJanela = Array.from({ length: 15 }, (_, i) => makeCheckin(String(i), i));
    arrange({ scheduledDays: [] }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.scheduledDaysInWindow).toBe(30);
    expect(stats.completedInWindow).toBe(15);
    expect(stats.completionRate).toBe(50);
  });

  it('INV-06: hábito de três vezes por semana cumprido à risca chega a 100%', async () => {
    // Este é o bug que a invariante existe para impedir. Com denominador 30 fixo,
    // um hábito de segunda/quarta/sexta cumprido integralmente marcava ~43% e
    // parecia negligência — e a IA redigiria um texto correto sobre esse número.
    const scheduledDays = [1, 3, 5];
    const dias = [
      ...diasDaSemanaNaJanela(1),
      ...diasDaSemanaNaJanela(3),
      ...diasDaSemanaNaJanela(5),
    ];
    const naJanela = dias.map((date, i) => ({
      id: `c${i}`,
      habitId: HABIT_ID,
      date,
      createdAt: new Date(),
    }));
    arrange({ scheduledDays }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.scheduledDaysInWindow).toBe(dias.length);
    expect(stats.completedInWindow).toBe(dias.length);
    expect(stats.completionRate).toBe(100);
  });

  it('INV-06: a janela nunca começa antes da criação do hábito', async () => {
    // Hábito criado ontem, cumprido nos dois dias em que existiu. Antes isso
    // aparecia como ~7%; agora a janela é de dois dias e a taxa é 100%.
    const naJanela = [makeCheckin('c0', 0), makeCheckin('c1', 1)];
    arrange({ createdAt: utcDaysAgo(1), scheduledDays: [] }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.windowDays).toBe(2);
    expect(stats.scheduledDaysInWindow).toBe(2);
    expect(stats.completionRate).toBe(100);
  });

  it('INV-06: a taxa é arredondada em duas casas', async () => {
    const naJanela = Array.from({ length: 10 }, (_, i) => makeCheckin(String(i), i));
    arrange({ scheduledDays: [] }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.completionRate).toBe(33.33);
  });

  it('INV-06: adversário — a taxa nunca passa de 100%, mesmo com check-in extra', async () => {
    // Agendado só às segundas, mas cumprido todos os dias: as segundas dão 100%
    // e o resto vira `extraCheckins`. Sem separar os dois, o numerador passaria
    // o denominador e a taxa iria a 400%.
    const scheduledDays = [1];
    const naJanela = Array.from({ length: 30 }, (_, i) => makeCheckin(String(i), i));
    arrange({ scheduledDays }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.completionRate).toBe(100);
    expect(stats.completionRate).toBeLessThanOrEqual(100);
    expect(stats.extraCheckins).toBe(30 - stats.scheduledDaysInWindow);
  });

  it('INV-06: totalCheckins conta o histórico todo, não só a janela', async () => {
    const todos = [makeCheckin('c1', 200), makeCheckin('c2', 15), makeCheckin('c3', 0)];
    arrange({}, todos, [todos[2]]);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.totalCheckins).toBe(3);
    expect(stats.completedInWindow).toBe(1);
  });
});

describe('INV-08 — check-in em dia não agendado não altera a aderência', () => {
  it('INV-08: check-in fora do agendamento é contado à parte e não muda a taxa', async () => {
    const scheduledDays = [1];
    const segundas = diasDaSemanaNaJanela(1);
    const tercas = diasDaSemanaNaJanela(2);
    const naJanela = [...segundas, ...tercas].map((date, i) => ({
      id: `c${i}`,
      habitId: HABIT_ID,
      date,
      createdAt: new Date(),
    }));
    arrange({ scheduledDays }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.completedInWindow).toBe(segundas.length);
    expect(stats.extraCheckins).toBe(tercas.length);
    expect(stats.completionRate).toBe(100);
  });

  it('INV-08: adversário — só check-in extra, sem nenhum dia agendado cumprido, dá 0%', async () => {
    // Fazer a mais não compensa não fazer o combinado. Se `extraCheckins`
    // entrasse no numerador, este caso marcaria aderência sem nenhum
    // compromisso cumprido.
    const scheduledDays = [1];
    const naJanela = diasDaSemanaNaJanela(2).map((date, i) => ({
      id: `c${i}`,
      habitId: HABIT_ID,
      date,
      createdAt: new Date(),
    }));
    arrange({ scheduledDays }, naJanela, naJanela);

    const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

    expect(stats.completedInWindow).toBe(0);
    expect(stats.completionRate).toBe(0);
    expect(stats.extraCheckins).toBeGreaterThan(0);
  });
});
