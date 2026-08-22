import { AdherenceReport, HabitAdherence } from './adherence.types';
import { Narrator, ProposalNarrationInput } from './narrator';

const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/**
 * Redator determinístico — o piso da camada de insights.
 *
 * Mesmo contrato do redator por modelo, sem chave, sem rede e sem variação entre
 * chamadas. É o que sustenta INV-15: sem `ANTHROPIC_API_KEY` o endpoint continua
 * respondendo texto útil, e não um erro nem um campo vazio. O Playground do
 * portfólio funciona assim — regra e texto curado, não modelo.
 *
 * Por construção ele nunca viola INV-14: todo número que ele escreve vem de um
 * campo do relatório, porque não há outra fonte no arquivo.
 */
export class DeterministicNarrator implements Narrator {
  readonly source = 'deterministic' as const;

  async narrate(report: AdherenceReport): Promise<string> {
    if (report.habitCount === 0) {
      return 'Você ainda não tem hábitos cadastrados. Crie o primeiro para começar a acompanhar sua aderência.';
    }

    const avaliaveis = report.habits.filter((habit) => habit.scheduledDaysInWindow > 0);
    if (avaliaveis.length === 0) {
      return `Você tem ${report.habitCount} ${plural(report.habitCount, 'hábito', 'hábitos')}, mas nenhum dia agendado caiu na janela de ${report.windowDays} dias. Ainda não há aderência para medir.`;
    }

    const frases: string[] = [];

    frases.push(
      `Nos últimos ${report.windowDays} dias você cumpriu ${report.overallCompletionRate}% dos dias agendados, considerando ${report.habitCount} ${plural(report.habitCount, 'hábito', 'hábitos')}.`
    );

    if (report.strongest) {
      frases.push(
        `O mais firme é ${report.strongest.title}, com ${report.strongest.completionRate}% — ${report.strongest.completedInWindow} de ${report.strongest.scheduledDaysInWindow} ${plural(report.strongest.scheduledDaysInWindow, 'dia agendado', 'dias agendados')}.`
      );
    }

    if (report.weakest && report.weakest.habitId !== report.strongest?.habitId) {
      frases.push(
        `O que mais escapa é ${report.weakest.title}, com ${report.weakest.completionRate}% — ${report.weakest.completedInWindow} de ${report.weakest.scheduledDaysInWindow}.`
      );
      const pior = report.weakest.weakestWeekdays[0];
      if (pior) {
        frases.push(
          `A falha se concentra ${nomeDoDia(pior.weekday)}: ${pior.missed} de ${pior.scheduled} ${plural(pior.scheduled, 'vez', 'vezes')} perdidas.`
        );
      }
    }

    const emRisco = report.habits.filter((habit) => habit.streakAtRisk);
    if (emRisco.length > 0) {
      frases.push(
        `${emRisco.length === 1 ? 'Uma sequência está' : `${emRisco.length} sequências estão`} em risco hoje: ${listar(emRisco.map((habit) => `${habit.title} (${habit.currentStreak})`))}.`
      );
    }

    const melhor = maiorSequencia(avaliaveis);
    if (melhor && melhor.currentStreak > 0 && !melhor.streakAtRisk) {
      frases.push(
        `A sequência mais longa em curso é de ${melhor.currentStreak} ${plural(melhor.currentStreak, 'dia', 'dias')} em ${melhor.title}.`
      );
    }

    return frases.join(' ');
  }

  async narrateProposal({ plan, habit }: ProposalNarrationInput): Promise<string> {
    const frases: string[] = [
      `${habit.title} está em ${habit.completionRate}%: ${habit.completedInWindow} de ${habit.scheduledDaysInWindow} ${plural(habit.scheduledDaysInWindow, 'dia agendado', 'dias agendados')}.`,
    ];

    for (const saida of plan.removed) {
      frases.push(
        `${capitalizar(soNome(saida.weekday))}: ${saida.missed} de ${saida.scheduled} ${plural(saida.scheduled, 'vez perdida', 'vezes perdidas')} — a sugestão é tirar esse dia.`
      );
    }

    for (const entrada of plan.added) {
      frases.push(
        `${capitalizar(soNome(entrada.weekday))}: ${entrada.hits} ${plural(entrada.hits, 'check-in', 'check-ins')} sem estar combinado — a sugestão é incluir esse dia.`
      );
    }

    frases.push('Aceite ou recuse: nada muda até você confirmar.');
    return frases.join(' ');
  }
}

/** Nome do dia sem preposição, para começar frase. */
function soNome(weekday: number): string {
  return WEEKDAYS[weekday] ?? 'um dia da semana';
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function maiorSequencia(habits: HabitAdherence[]): HabitAdherence | null {
  return (
    [...habits].sort(
      (a, b) => b.currentStreak - a.currentStreak || a.title.localeCompare(b.title)
    )[0] ?? null
  );
}

function nomeDoDia(weekday: number): string {
  const nome = WEEKDAYS[weekday];
  // O relatório só produz 0..6; o fallback existe para não emitir "undefined"
  // caso um dado antigo tenha entrado no banco antes da validação de conjunto.
  return nome ? `${preposicao(weekday)} ${nome}` : 'em um dia da semana';
}

function preposicao(weekday: number): string {
  return weekday === 0 || weekday === 6 ? 'no' : 'na';
}

function plural(quantidade: number, singular: string, plural_: string): string {
  return quantidade === 1 ? singular : plural_;
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}
