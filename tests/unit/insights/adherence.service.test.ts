import fs from 'node:fs';
import path from 'node:path';
import { AdherenceService } from '@/insights/adherence.service';
import { verifyNarration } from '@/insights/narration.guard';
import { DeterministicNarrator } from '@/insights/narrator.deterministic';
import { addUtcDays, utcStartOfDay, utcWeekday } from '@/utils/helpers';

const habitsRepository = { findByUserId: jest.fn() };
const checkinsRepository = {
  findByHabitIdsAndDateRange: jest.fn(),
  findByHabitIds: jest.fn(),
};

const service = new AdherenceService(
  habitsRepository as never,
  checkinsRepository as never
);

const USER_ID = 'user-1';
const NASCIDO_LONGE = addUtcDays(utcStartOfDay(), -400);

function habit(over: Record<string, unknown> = {}) {
  return {
    id: 'habit-1',
    userId: USER_ID,
    title: 'Correr',
    description: null,
    scheduledDays: [] as number[],
    createdAt: NASCIDO_LONGE,
    updatedAt: new Date(),
    ...over,
  };
}

function checkin(habitId: string, offsetDays: number) {
  return { id: `c-${habitId}-${offsetDays}`, habitId, date: addUtcDays(utcStartOfDay(), -offsetDays) };
}

/** Os dias da janela que caem num dia da semana. */
function diasDaSemanaNaJanela(weekday: number): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset < 30; offset++) {
    if (utcWeekday(addUtcDays(utcStartOfDay(), -offset)) === weekday) offsets.push(offset);
  }
  return offsets;
}

function arrange(habits: unknown[], checkins: unknown[]) {
  habitsRepository.findByUserId.mockResolvedValue(habits);
  checkinsRepository.findByHabitIdsAndDateRange.mockResolvedValue(checkins);
  checkinsRepository.findByHabitIds.mockResolvedValue(checkins);
}

describe('INV-13 — todo número do relatório nasce de contagem', () => {
  it('INV-13: usuário sem hábito devolve relatório vazio e coerente', async () => {
    arrange([], []);

    const report = await service.buildReport(USER_ID);

    expect(report).toMatchObject({
      habitCount: 0,
      overallCompletionRate: 0,
      habits: [],
      strongest: null,
      weakest: null,
    });
  });

  it('INV-13: a taxa geral é a média das taxas dos hábitos avaliáveis', async () => {
    // Um cumprido às segundas e o outro nunca: 100% e 0% → média 50%.
    const segundas = diasDaSemanaNaJanela(1);
    arrange(
      [habit({ id: 'a', scheduledDays: [1] }), habit({ id: 'b', title: 'Ler', scheduledDays: [1] })],
      segundas.map((offset) => checkin('a', offset))
    );

    const report = await service.buildReport(USER_ID);

    expect(report.habits.find((h) => h.habitId === 'a')?.completionRate).toBe(100);
    expect(report.habits.find((h) => h.habitId === 'b')?.completionRate).toBe(0);
    expect(report.overallCompletionRate).toBe(50);
  });

  it('INV-13: strongest e weakest apontam para os extremos da janela', async () => {
    const segundas = diasDaSemanaNaJanela(1);
    arrange(
      [habit({ id: 'a', title: 'Correr', scheduledDays: [1] }), habit({ id: 'b', title: 'Ler', scheduledDays: [1] })],
      segundas.map((offset) => checkin('a', offset))
    );

    const report = await service.buildReport(USER_ID);

    expect(report.strongest?.habitId).toBe('a');
    expect(report.weakest?.habitId).toBe('b');
  });

  it('INV-13: adversário — hábito sem dia agendado na janela não entra na média', async () => {
    // Um hábito criado hoje num dia que ele não agenda tem denominador zero.
    // Incluí-lo como 0% puxaria a média para baixo por um dado que não existe.
    const hoje = utcWeekday(utcStartOfDay());
    const outroDia = (hoje + 3) % 7;
    const segundas = diasDaSemanaNaJanela(1);

    arrange(
      [
        habit({ id: 'a', scheduledDays: [1] }),
        habit({ id: 'b', title: 'Novo', scheduledDays: [outroDia], createdAt: utcStartOfDay() }),
      ],
      segundas.map((offset) => checkin('a', offset))
    );

    const report = await service.buildReport(USER_ID);

    expect(report.habits.find((h) => h.habitId === 'b')?.scheduledDaysInWindow).toBe(0);
    expect(report.overallCompletionRate).toBe(100);
  });

  it('INV-13: o desempate de strongest é estável entre chamadas', async () => {
    // Sem desempate determinístico, dois hábitos empatados alternariam de posição
    // entre chamadas e o resumo mudaria de assunto sem nada ter mudado.
    const segundas = diasDaSemanaNaJanela(1);
    arrange(
      [habit({ id: 'z', title: 'Zelar', scheduledDays: [1] }), habit({ id: 'a', title: 'Andar', scheduledDays: [1] })],
      [...segundas.map((o) => checkin('z', o)), ...segundas.map((o) => checkin('a', o))]
    );

    const primeira = await service.buildReport(USER_ID);
    const segunda = await service.buildReport(USER_ID);

    expect(primeira.strongest?.habitId).toBe('a');
    expect(primeira).toEqual(segunda);
  });

  it('INV-13: weakestWeekdays só lista dias que realmente falharam, do pior para o menos pior', async () => {
    const segundas = diasDaSemanaNaJanela(1);
    const quartas = diasDaSemanaNaJanela(3);
    // Cumpre todas as segundas e nenhuma quarta.
    arrange(
      [habit({ scheduledDays: [1, 3] })],
      segundas.map((offset) => checkin('habit-1', offset))
    );

    const report = await service.buildReport(USER_ID);
    const detalhe = report.habits[0]!;

    expect(detalhe.weakestWeekdays).toEqual([
      { weekday: 3, scheduled: quartas.length, missed: quartas.length },
    ]);
  });

  it('INV-08/INV-13: extrasByWeekday registra onde caiu o check-in não agendado', async () => {
    const tercas = diasDaSemanaNaJanela(2);
    arrange(
      [habit({ scheduledDays: [1] })],
      tercas.map((offset) => checkin('habit-1', offset))
    );

    const report = await service.buildReport(USER_ID);

    expect(report.habits[0]?.extrasByWeekday).toEqual([{ weekday: 2, hits: tercas.length }]);
    expect(report.habits[0]?.completionRate).toBe(0);
  });

  it('INV-13: adversário — o relatório inteiro passa pelo guarda quando redigido', async () => {
    // Fecha o laço: cálculo → redação determinística → guarda numérico. Se um
    // campo novo entrar no relatório sem entrar no conjunto permitido, cai aqui.
    const segundas = diasDaSemanaNaJanela(1);
    arrange(
      [habit({ id: 'a', scheduledDays: [1] }), habit({ id: 'b', title: 'Ler', scheduledDays: [1, 3] })],
      segundas.map((offset) => checkin('a', offset))
    );

    const report = await service.buildReport(USER_ID);
    const texto = await new DeterministicNarrator().narrate(report);

    expect(verifyNarration(texto, report)).toEqual({ ok: true, offending: [] });
  });

  it('INV-02: o relatório usa consulta em lote, não uma por hábito', async () => {
    // Com `findByHabitIdAndDateRange` num laço, 20 hábitos geravam 20 consultas
    // por requisição de insight. A porta continua sendo o repositório.
    arrange([habit({ id: 'a' }), habit({ id: 'b' }), habit({ id: 'c' })], []);

    await service.buildReport(USER_ID);

    expect(checkinsRepository.findByHabitIdsAndDateRange).toHaveBeenCalledTimes(1);
    expect(checkinsRepository.findByHabitIdsAndDateRange).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      expect.any(Date),
      expect.any(Date)
    );
  });
});

describe('INV-01 — um check-in por hábito por dia é garantia do banco', () => {
  it('INV-01: o schema declara a constraint única em (habitId, date)', () => {
    // A garantia é do banco, não da consulta prévia no service. Se a linha
    // `@@unique([habitId, date])` sair do schema, a duplicata deixa de ser
    // impossível e passa a depender de tempo — e este teste é o que avisa.
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8'
    );

    expect(schema).toMatch(/@@unique\(\[habitId,\s*date\]\)/);
  });

  it('INV-04: a coluna de data é DATE, não timestamp', () => {
    // `@db.Date` é o que faz a constraint valer por DIA. Com timestamp, dois
    // check-ins do mesmo dia em horas diferentes seriam duas linhas válidas.
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8'
    );

    expect(schema).toMatch(/date\s+DateTime\s+@default\(now\(\)\)\s+@db\.Date/);
  });
});
