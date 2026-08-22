export interface HabitStats {
  totalCheckins: number;
  currentStreak: number;
  bestStreak: number;
  /** Percentual de dias agendados cumpridos dentro da janela avaliada. */
  completionRate: number;

  /**
   * Os quatro campos abaixo existem para que quem apresenta a estatística — a
   * interface ou a redação por IA — não precise recalcular nada nem inventar o
   * denominador. "70%" sem saber sobre quantos dias é um número sem sentido.
   */
  /** Tamanho real da janela avaliada, em dias. Nunca começa antes do hábito. */
  windowDays: number;
  /** Dias agendados dentro da janela. É o denominador de `completionRate`. */
  scheduledDaysInWindow: number;
  /** Dias agendados que tiveram check-in. É o numerador. */
  completedInWindow: number;
  /** Check-ins em dias não agendados. Não entram na conta — nem a favor, nem contra. */
  extraCheckins: number;
}

export interface HabitWithStats {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  stats: HabitStats;
}
