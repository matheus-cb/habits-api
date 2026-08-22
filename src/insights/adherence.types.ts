/**
 * Relatório de aderência: a única fonte de números da camada de insights.
 *
 * Todo campo aqui nasce de contagem sobre check-ins gravados. O modelo de
 * linguagem recebe este objeto e devolve **texto** — ele não soma, não divide e
 * não estima (INV-13). Se um número aparece na redação, ele veio daqui, e o
 * guarda de redação verifica isso (INV-14).
 */

/** Aderência de um hábito na janela avaliada. */
export interface HabitAdherence {
  habitId: string;
  title: string;
  /** Dias da semana cobrados. Vazio significa todo dia. */
  scheduledDays: number[];
  /** Denominador: dias agendados dentro da janela. */
  scheduledDaysInWindow: number;
  /** Numerador: dias agendados cumpridos. */
  completedInWindow: number;
  /** Check-ins fora dos dias agendados. Não entram no percentual. */
  extraCheckins: number;
  /** `completedInWindow / scheduledDaysInWindow`, em pontos percentuais. */
  completionRate: number;
  currentStreak: number;
  bestStreak: number;
  /**
   * Dias da semana em que o hábito falhou mais na janela, do pior para o menos
   * pior, e só os que têm pelo menos uma falha. Vazio se não houve falha.
   */
  weakestWeekdays: WeekdayMiss[];
  /**
   * Dias da semana em que houve check-in **sem** estar agendado. É o sinal de
   * que a rotina real difere da combinada — insumo da proposta de reagendamento.
   */
  extrasByWeekday: WeekdayHit[];
  /** Sequência que quebra se o próximo dia agendado for perdido. */
  streakAtRisk: boolean;
}

export interface WeekdayHit {
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Check-ins nesse dia da semana, dentro da janela, fora do agendamento. */
  hits: number;
}

export interface WeekdayMiss {
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Dias agendados nesse dia da semana, dentro da janela. */
  scheduled: number;
  /** Quantos deles foram perdidos. */
  missed: number;
}

export interface AdherenceReport {
  /** Tamanho real da janela. Nunca começa antes do hábito mais novo relevante. */
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  habitCount: number;
  /** Média simples das taxas dos hábitos com pelo menos um dia agendado. */
  overallCompletionRate: number;
  habits: HabitAdherence[];
  /** Hábito de maior taxa na janela. `null` quando não há hábito avaliável. */
  strongest: HabitAdherence | null;
  /** Hábito de menor taxa na janela. */
  weakest: HabitAdherence | null;
}

/** Quem redigiu o resumo. Vai na resposta HTTP — INV-15. */
export type NarrationSource = 'model' | 'deterministic';

export interface AdherenceNarration {
  summary: string;
  source: NarrationSource;
  /**
   * Preenchido quando a redação do modelo foi descartada e o determinístico
   * assumiu. É o rastro auditável de INV-14 e INV-15 — nunca carrega prompt,
   * chave ou raciocínio do modelo, só o motivo em uma palavra (INV-16).
   */
  fallbackReason?: FallbackReason;
}

export type FallbackReason =
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAVAILABLE'
  | 'AI_REFUSED'
  | 'AI_NUMBERS_UNVERIFIED'
  | 'AI_EMPTY_RESPONSE';

export interface AdherenceInsightResponse {
  report: AdherenceReport;
  narration: AdherenceNarration;
}
