import {
  addUtcDays,
  calculateBestStreak,
  calculateStreak,
  countScheduledDays,
  formatDate,
  isSameDay,
  isScheduledOn,
  previousScheduledDay,
  toDayKey,
  utcStartOfDay,
  utcWeekday,
} from '@/utils/helpers';

/** Meia-noite UTC de N dias atrás — a mesma forma que o Prisma devolve `@db.Date`. */
function utcDaysAgo(n: number): Date {
  return addUtcDays(utcStartOfDay(), -n);
}

/** Data UTC de um dia da semana específico, o mais recente que não seja hoje. */
function ultimoDiaDaSemana(weekday: number): Date {
  let cursor = addUtcDays(utcStartOfDay(), -1);
  for (let i = 0; i < 7; i++) {
    if (utcWeekday(cursor) === weekday) return cursor;
    cursor = addUtcDays(cursor, -1);
  }
  throw new Error('inalcançável: sete passos cobrem a semana');
}

describe('INV-04 — o dia do check-in é resolvido em UTC', () => {
  it('INV-04: utcStartOfDay preserva o dia de calendário UTC, não o local', () => {
    // 2026-06-15T02:00Z é 2026-06-14 23:00 no horário de Brasília. A versão
    // anterior usava setHours(0,0,0,0) e devolvia o dia 14 — o bug que fazia a
    // regra "um check-in por dia" depender do fuso da máquina.
    const resultado = utcStartOfDay(new Date('2026-06-15T02:00:00.000Z'));

    expect(resultado.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(resultado.getUTCDate()).toBe(15);
  });

  it('INV-04: adversário — data no fim do dia UTC não escorrega para o dia seguinte', () => {
    const resultado = utcStartOfDay(new Date('2026-06-15T23:59:59.999Z'));
    expect(toDayKey(resultado)).toBe('2026-06-15');
  });

  it('INV-04: adversário — data no começo do dia UTC não recua para o anterior', () => {
    const resultado = utcStartOfDay(new Date('2026-06-15T00:00:00.000Z'));
    expect(toDayKey(resultado)).toBe('2026-06-15');
  });

  it('INV-04: toDayKey e formatDate concordam, e ambos são UTC', () => {
    const data = new Date('2026-01-01T03:30:00.000Z');
    expect(toDayKey(data)).toBe('2026-01-01');
    expect(formatDate(data)).toBe(toDayKey(data));
  });

  it('INV-04: isSameDay compara dia de calendário UTC, não instante', () => {
    expect(
      isSameDay(new Date('2026-03-10T00:00:01.000Z'), new Date('2026-03-10T23:59:59.000Z'))
    ).toBe(true);
    expect(
      isSameDay(new Date('2026-03-10T23:59:59.000Z'), new Date('2026-03-11T00:00:01.000Z'))
    ).toBe(false);
  });

  it('INV-04: addUtcDays atravessa mudança de horário de verão sem perder um dia', () => {
    // No Brasil o horário de verão foi extinto, mas o servidor pode rodar em
    // qualquer fuso. Somar 86.400.000 ms sobre meia-noite UTC é imune a isso;
    // setDate() sobre meia-noite local não era.
    const antes = new Date('2026-03-07T00:00:00.000Z');
    expect(toDayKey(addUtcDays(antes, 1))).toBe('2026-03-08');
    expect(toDayKey(addUtcDays(antes, 2))).toBe('2026-03-09');
  });
});

describe('INV-07 — scheduledDays vazio significa todo dia', () => {
  it('INV-07: conjunto vazio agenda qualquer dia da semana', () => {
    for (let weekday = 0; weekday <= 6; weekday++) {
      const dia = ultimoDiaDaSemana(weekday);
      expect(isScheduledOn(dia, [])).toBe(true);
    }
  });

  it('INV-07: conjunto explícito agenda só os dias listados', () => {
    const segunda = ultimoDiaDaSemana(1);
    const terca = ultimoDiaDaSemana(2);

    expect(isScheduledOn(segunda, [1, 3, 5])).toBe(true);
    expect(isScheduledOn(terca, [1, 3, 5])).toBe(false);
  });

  it('INV-07: previousScheduledDay devolve null para conjunto inválido, em vez de girar', () => {
    // Um array que não contém nenhum dia de 0 a 6 nunca casa. O laço tem limite
    // de sete passos exatamente para que isto termine.
    expect(previousScheduledDay(utcStartOfDay(), [99])).toBeNull();
  });

  it('INV-07: countScheduledDays conta os dois extremos do intervalo', () => {
    const de = new Date('2026-06-01T00:00:00.000Z'); // segunda-feira
    const ate = new Date('2026-06-07T00:00:00.000Z'); // domingo

    expect(countScheduledDays(de, ate, [])).toBe(7);
    expect(countScheduledDays(de, ate, [1])).toBe(1);
    expect(countScheduledDays(de, ate, [1, 3, 5])).toBe(3);
    expect(countScheduledDays(de, de, [1])).toBe(1);
  });
});

describe('INV-06 — a sequência conta só dias agendados', () => {
  it('INV-06: hábito diário conta dias de calendário consecutivos', () => {
    expect(calculateStreak([utcDaysAgo(0), utcDaysAgo(1), utcDaysAgo(2)])).toBe(3);
  });

  it('INV-06: dia não agendado é vão, não falha', () => {
    // Agendado às segundas, quartas e sextas. Cumprir as três últimas ocorrências
    // é sequência 3 — a versão por calendário devolvia 1, porque terça e quinta
    // "quebravam" uma sequência que ninguém havia prometido.
    const scheduledDays = [1, 3, 5];
    const cumpridos: Date[] = [];
    let cursor: Date | null = utcStartOfDay();
    if (!isScheduledOn(cursor, scheduledDays)) {
      cursor = previousScheduledDay(cursor, scheduledDays);
    }
    for (let i = 0; i < 3 && cursor; i++) {
      cumpridos.push(cursor);
      cursor = previousScheduledDay(cursor, scheduledDays);
    }

    expect(calculateStreak(cumpridos, scheduledDays)).toBe(3);
  });

  it('INV-06: um dia agendado sem check-in quebra a sequência', () => {
    // Cumpriu anteontem e antes, mas faltou ontem: hábito diário, sequência zero
    // porque a carência vale só para hoje.
    expect(calculateStreak([utcDaysAgo(2), utcDaysAgo(3)])).toBe(0);
  });

  it('INV-06: hoje ainda não terminou — não ter cumprido hoje não zera a sequência', () => {
    expect(calculateStreak([utcDaysAgo(1), utcDaysAgo(2)])).toBe(2);
  });

  it('INV-06: sem check-in nenhum a sequência é zero', () => {
    expect(calculateStreak([])).toBe(0);
    expect(calculateBestStreak([])).toBe(0);
  });

  it('INV-06: adversário — check-ins repetidos no mesmo dia não inflam a sequência', () => {
    // Dois registros do mesmo dia (possível em dado anterior à constraint) não
    // podem contar duas vezes: a contagem é sobre dias distintos.
    const hoje = utcDaysAgo(0);
    const duplicado = new Date(hoje.getTime());

    expect(calculateStreak([hoje, duplicado])).toBe(1);
    expect(calculateBestStreak([hoje, duplicado])).toBe(1);
  });

  it('INV-06: adversário — check-ins fora de ordem produzem a mesma sequência', () => {
    const embaralhado = [utcDaysAgo(2), utcDaysAgo(0), utcDaysAgo(1)];
    expect(calculateStreak(embaralhado)).toBe(3);
  });

  it('INV-06: melhor sequência histórica é maior que a atual quando houve corrida melhor', () => {
    const checkins = [
      utcDaysAgo(0),
      utcDaysAgo(1),
      // buraco em 2..5
      utcDaysAgo(6),
      utcDaysAgo(7),
      utcDaysAgo(8),
      utcDaysAgo(9),
      utcDaysAgo(10),
    ];

    expect(calculateStreak(checkins)).toBe(2);
    expect(calculateBestStreak(checkins)).toBe(5);
  });

  it('INV-08: check-in em dia não agendado não emenda sequência', () => {
    // Agendado só na segunda. Um check-in na terça é bem-vindo, mas não vira
    // sequência de 2 — o compromisso era um dia.
    const segunda = ultimoDiaDaSemana(1);
    const terca = addUtcDays(segunda, 1);

    expect(calculateBestStreak([segunda, terca], [1])).toBe(1);
  });
});
