import { HabitAdherence } from './adherence.types';

/**
 * Motor de reagendamento. Determinístico e sem IA.
 *
 * Quem escolhe os dias é este arquivo — nunca o modelo (INV-18). O modelo, se
 * houver chave, redige a justificativa; e mesmo essa justificativa passa pelo
 * guarda numérico. A separação importa: uma proposta de dias vinda de saída
 * probabilística seria impossível de auditar, e "aceitar ou recusar" deixaria de
 * ser uma decisão informada.
 */

/** A partir de que fração de falhas um dia da semana é candidato a sair. */
const LIMITE_DE_FALHA = 0.6;
/** Ocorrências mínimas para o sinal não ser ruído de uma semana ruim. */
const OCORRENCIAS_MINIMAS = 2;
/** Check-ins fora do agendamento para um dia novo ser candidato a entrar. */
const EXTRAS_MINIMOS = 2;
/** Acima disso o hábito está funcionando e não há o que propor. */
const ADERENCIA_BOA = 80;

export interface ReschedulePlan {
  habitId: string;
  currentScheduledDays: number[];
  proposedScheduledDays: number[];
  /** Dias que saem, e por quê, em números do relatório. */
  removed: { weekday: number; missed: number; scheduled: number }[];
  /** Dias que entram, e com quantos check-ins espontâneos se sustentam. */
  added: { weekday: number; hits: number }[];
}

/**
 * Devolve o plano, ou `null` quando não há proposta a fazer.
 *
 * `null` é um resultado legítimo e frequente: hábito em dia, sem sinal
 * suficiente, ou plano idêntico ao atual. Propor mudança sem sinal é o modo de
 * falha mais provável desta funcionalidade — e o mais fácil de disfarçar com
 * texto convincente.
 */
export function planReschedule(habit: HabitAdherence): ReschedulePlan | null {
  // Hábito "todo dia" (scheduledDays vazio) não é reagendável por este motor:
  // remover dias de um conjunto vazio exigiria escolher os sete primeiro, e o
  // sinal de falha por dia da semana não sustenta essa decisão.
  if (habit.scheduledDays.length === 0) return null;
  if (habit.scheduledDaysInWindow === 0) return null;
  if (habit.completionRate >= ADERENCIA_BOA) return null;

  const atual = [...habit.scheduledDays].sort((a, b) => a - b);

  const removed = habit.weakestWeekdays
    .filter(
      (miss) =>
        miss.scheduled >= OCORRENCIAS_MINIMAS && miss.missed / miss.scheduled >= LIMITE_DE_FALHA
    )
    .map((miss) => ({ weekday: miss.weekday, missed: miss.missed, scheduled: miss.scheduled }));

  const added = habit.extrasByWeekday
    .filter((extra) => extra.hits >= EXTRAS_MINIMOS && !atual.includes(extra.weekday))
    .map((extra) => ({ weekday: extra.weekday, hits: extra.hits }));

  if (removed.length === 0 && added.length === 0) return null;

  const paraRemover = new Set(removed.map((item) => item.weekday));
  let proposto = atual.filter((weekday) => !paraRemover.has(weekday));
  for (const item of added) proposto.push(item.weekday);
  proposto = [...new Set(proposto)].sort((a, b) => a - b);

  // Conjunto vazio significa "todo dia" no domínio (INV-07) — o oposto de
  // aliviar a rotina. Se tudo saiu, mantém-se o dia menos falhado.
  if (proposto.length === 0) {
    const menosFalhado = [...habit.weakestWeekdays].sort(
      (a, b) => a.missed / a.scheduled - b.missed / b.scheduled || a.weekday - b.weekday
    )[0];
    const resgatado = menosFalhado?.weekday ?? atual[0];
    if (resgatado === undefined) return null;
    proposto = [resgatado];
  }

  if (mesmoConjunto(atual, proposto)) return null;

  return {
    habitId: habit.habitId,
    currentScheduledDays: atual,
    proposedScheduledDays: proposto,
    removed: removed.filter((item) => !proposto.includes(item.weekday)),
    added: added.filter((item) => proposto.includes(item.weekday)),
  };
}

function mesmoConjunto(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
