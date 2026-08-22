/**
 * Dias de calendário, sempre em UTC.
 *
 * A coluna `checkins.date` é `@db.Date` e o Prisma a devolve como meia-noite
 * UTC. O código anterior comparava essas datas com `setHours(0,0,0,0)`, que é
 * meia-noite LOCAL: em qualquer fuso à frente de UTC o mesmo check-in caía no
 * dia anterior, e a regra "um check-in por hábito por dia" passava a depender do
 * fuso da máquina. Tudo aqui usa `getUTC*`/`Date.UTC` por esse motivo.
 */

/** Dia de calendário em UTC, no formato `YYYY-MM-DD`. */
export type DayKey = string;

/** Meia-noite UTC do dia de calendário a que a data pertence. */
export function utcStartOfDay(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

/** Chave de dia em UTC. É o que identifica um dia em conjuntos e mapas. */
export function toDayKey(date: Date): DayKey {
  return utcStartOfDay(date).toISOString().slice(0, 10);
}

/** Dia da semana em UTC: 0 = domingo … 6 = sábado, igual a `scheduledDays`. */
export function utcWeekday(date: Date): number {
  return date.getUTCDay();
}

/** Soma (ou subtrai) dias de calendário sem esbarrar em horário de verão. */
export function addUtcDays(date: Date, days: number): Date {
  const start = utcStartOfDay(date);
  return new Date(start.getTime() + days * 86_400_000);
}

/**
 * `scheduledDays` vazio significa "todo dia" — é o default do schema e o
 * comportamento de todo hábito criado antes do agendamento existir.
 */
export function isScheduledOn(date: Date, scheduledDays: number[] = []): boolean {
  if (scheduledDays.length === 0) return true;
  return scheduledDays.includes(utcWeekday(date));
}

/**
 * Dia agendado imediatamente anterior a `date`. Um conjunto válido tem pelo
 * menos um dia entre 0 e 6, então sete passos bastam; o limite existe para que
 * um array inválido devolva null em vez de girar para sempre.
 */
export function previousScheduledDay(date: Date, scheduledDays: number[] = []): Date | null {
  for (let step = 1; step <= 7; step++) {
    const candidate = addUtcDays(date, -step);
    if (isScheduledOn(candidate, scheduledDays)) return candidate;
  }
  return null;
}

/** Quantos dias agendados existem em [from, to], ambos inclusive. */
export function countScheduledDays(from: Date, to: Date, scheduledDays: number[] = []): number {
  let total = 0;
  let cursor = utcStartOfDay(from);
  const last = utcStartOfDay(to);
  while (cursor.getTime() <= last.getTime()) {
    if (isScheduledOn(cursor, scheduledDays)) total++;
    cursor = addUtcDays(cursor, 1);
  }
  return total;
}

/**
 * Sequência atual, contada só sobre dias agendados.
 *
 * Um dia não agendado é vão, não falha: quem se compromete com segunda, quarta e
 * sexta e cumpre as três tem sequência 3, não 1. Só um dia agendado sem check-in
 * quebra a contagem.
 *
 * O dia de hoje tem carência: se hoje é agendado e ainda não houve check-in, a
 * sequência é contada até o dia agendado anterior em vez de zerar — o dia ainda
 * não terminou. Era o mesmo espírito do "hoje ou ontem" da versão anterior.
 */
export function calculateStreak(checkins: Date[], scheduledDays: number[] = []): number {
  if (checkins.length === 0) return 0;

  const done = new Set(checkins.map(toDayKey));
  let cursor: Date | null = utcStartOfDay();

  if (!isScheduledOn(cursor, scheduledDays) || !done.has(toDayKey(cursor))) {
    cursor = previousScheduledDay(cursor, scheduledDays);
  }

  let streak = 0;
  while (cursor && done.has(toDayKey(cursor))) {
    streak++;
    cursor = previousScheduledDay(cursor, scheduledDays);
  }

  return streak;
}

/**
 * Maior sequência já alcançada, pela mesma regra de `calculateStreak`.
 *
 * Check-in em dia não agendado é ignorado aqui: ele não conta como falha nem
 * emenda uma sequência que o agendamento não pede.
 */
export function calculateBestStreak(checkins: Date[], scheduledDays: number[] = []): number {
  const days = [...new Set(checkins.map(toDayKey))]
    .map((key) => new Date(`${key}T00:00:00.000Z`))
    .filter((date) => isScheduledOn(date, scheduledDays))
    .sort((a, b) => a.getTime() - b.getTime());

  let best = 0;
  let run = 0;
  let previous: Date | null = null;

  for (const day of days) {
    const expected = previousScheduledDay(day, scheduledDays);
    const emenda =
      previous !== null && expected !== null && expected.getTime() === previous.getTime();
    run = emenda ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }

  return best;
}

/** Formata como `YYYY-MM-DD` em UTC. Alias de `toDayKey`, mantido pelo nome. */
export function formatDate(date: Date): string {
  return toDayKey(date);
}

/** Mesmo dia de calendário, em UTC. */
export function isSameDay(date1: Date, date2: Date): boolean {
  return toDayKey(date1) === toDayKey(date2);
}

/**
 * @deprecated Use `utcStartOfDay`. Mantido só para não quebrar import externo;
 * o comportamento agora é UTC, não local.
 */
export const startOfDay = utcStartOfDay;
