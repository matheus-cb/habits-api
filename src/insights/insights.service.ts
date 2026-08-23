import { logger } from '@/utils/logger';
import {
  AdherenceInsightResponse,
  AdherenceNarration,
  AdherenceReport,
  FallbackReason,
  HabitAdherence,
} from './adherence.types';
import { AdherenceService } from './adherence.service';
import { NarrationFailure, Narrator } from './narrator';
import { DeterministicNarrator } from './narrator.deterministic';
import { ProposalService, RescheduleProposal, RescheduleResult } from './proposal.service';
import { ReschedulePlan } from './reschedule.engine';

/**
 * Orquestra a camada de insights.
 *
 * É o único lugar que sabe que existem dois redatores, e a única coisa que ele
 * faz com essa informação é: tentar o preferido; se falhar por qualquer motivo,
 * usar o determinístico e registrar o motivo na resposta. Nunca propagar erro de
 * IA para o usuário (INV-15).
 *
 * O redator determinístico é injetado como `fallback` e não construído aqui para
 * que o teste possa provar que ele é usado — provar o fallback é mais importante
 * do que economizar um parâmetro.
 */
/**
 * Teto de propostas redigidas por requisição.
 *
 * Sem ele, `getProposals` chamava o modelo uma vez por proposta, em série: um
 * usuário com 8 hábitos em risco custava 8 chamadas e, com `AI_TIMEOUT_MS` em
 * 20s, até 160 segundos numa única requisição HTTP. Era o vetor de custo real da
 * camada, e sem registro de execução ninguém saberia que aconteceu.
 *
 * 5 é escolha de produto, não técnica: mais de cinco sugestões de reagendamento
 * de uma vez não é ajuda, é lista de tarefas. As demais propostas continuam na
 * resposta — só a justificativa delas vem do redator determinístico.
 */
const MAXIMO_DE_JUSTIFICATIVAS_POR_MODELO = 5;

export class InsightsService {
  constructor(
    private adherence: AdherenceService,
    private proposals: ProposalService,
    /** Redator preferido. `null` quando não há provedor configurado. */
    private preferred: Narrator | null,
    private fallback: Narrator = new DeterministicNarrator()
  ) {}

  async getAdherence(userId: string): Promise<AdherenceInsightResponse> {
    const report = await this.adherence.buildReport(userId);
    const narration = await this.narrate(report);
    return { report, narration };
  }

  async getProposals(userId: string): Promise<RescheduleProposal[]> {
    const report = await this.adherence.buildReport(userId);
    const plans = this.proposals.buildProposals(report);

    // O plano nasce de um hábito do relatório; o filtro é defensivo contra uma
    // refatoração futura que desconecte as duas listas.
    const comHabito = plans
      .map((plan) => ({ plan, habit: report.habits.find((h) => h.habitId === plan.habitId) }))
      .filter((item): item is { plan: ReschedulePlan; habit: HabitAdherence } =>
        Boolean(item.habit)
      );

    // Ordena pela pior aderência: se houver teto, o modelo redige onde importa
    // mais, e não o que o relatório devolveu primeiro.
    const ordenados = [...comHabito].sort(
      (a, b) =>
        a.habit.completionRate - b.habit.completionRate ||
        a.habit.title.localeCompare(b.habit.title)
    );
    const comModelo = new Set(
      ordenados.slice(0, MAXIMO_DE_JUSTIFICATIVAS_POR_MODELO).map((item) => item.plan.habitId)
    );

    // Em paralelo, não em série. As chamadas são independentes: em série, o
    // tempo era a SOMA dos timeouts; aqui é o maior deles.
    return Promise.all(
      comHabito.map(async ({ plan, habit }) => {
        const { token, expiresAt } = this.proposals.sign(userId, plan);
        const { text, source } = comModelo.has(plan.habitId)
          ? await this.narrateProposal({ plan, habit, report })
          : {
              text: await this.fallback.narrateProposal({ plan, habit, report }),
              source: this.fallback.source,
            };

        return {
          ...plan,
          title: habit.title,
          rationale: text,
          rationaleSource: source,
          expiresAt: expiresAt.toISOString(),
          token,
        };
      })
    );
  }

  async confirmProposal(
    userId: string,
    token: string,
    via: 'user' | 'assistant' = 'user'
  ): Promise<RescheduleResult> {
    return this.proposals.confirm(userId, token, Date.now(), via);
  }

  private async narrate(report: AdherenceReport): Promise<AdherenceNarration> {
    if (!this.preferred) {
      return {
        summary: await this.fallback.narrate(report),
        source: this.fallback.source,
        fallbackReason: 'AI_NOT_CONFIGURED',
      };
    }

    try {
      return { summary: await this.preferred.narrate(report), source: this.preferred.source };
    } catch (error) {
      const reason = motivo(error);
      logger.warn(`redação caiu para o determinístico: ${reason}`);
      return {
        summary: await this.fallback.narrate(report),
        source: this.fallback.source,
        fallbackReason: reason,
      };
    }
  }

  private async narrateProposal(
    input: Parameters<Narrator['narrateProposal']>[0]
  ): Promise<{ text: string; source: 'model' | 'deterministic' }> {
    if (this.preferred) {
      try {
        return {
          text: await this.preferred.narrateProposal(input),
          source: this.preferred.source,
        };
      } catch (error) {
        logger.warn(`justificativa caiu para o determinístico: ${motivo(error)}`);
      }
    }
    return { text: await this.fallback.narrateProposal(input), source: this.fallback.source };
  }
}

/**
 * Qualquer erro que não seja `NarrationFailure` vira `AI_UNAVAILABLE`. O motivo
 * exposto é sempre um dos cinco códigos — nunca a mensagem original, que pode
 * carregar trecho de prompt ou detalhe do provedor (INV-16).
 */
function motivo(error: unknown): FallbackReason {
  return error instanceof NarrationFailure ? error.reason : 'AI_UNAVAILABLE';
}
