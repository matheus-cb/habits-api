import { logger } from '@/utils/logger';
import {
  AdherenceInsightResponse,
  AdherenceNarration,
  AdherenceReport,
  FallbackReason,
} from './adherence.types';
import { AdherenceService } from './adherence.service';
import { NarrationFailure, Narrator } from './narrator';
import { DeterministicNarrator } from './narrator.deterministic';
import { ProposalService, RescheduleProposal, RescheduleResult } from './proposal.service';

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

    const resultado: RescheduleProposal[] = [];
    for (const plan of plans) {
      const habit = report.habits.find((item) => item.habitId === plan.habitId);
      // O plano nasce de um hábito do relatório; a checagem é defensiva contra
      // uma refatoração futura que desconecte as duas listas.
      if (!habit) continue;

      const { token, expiresAt } = this.proposals.sign(userId, plan);
      const { text, source } = await this.narrateProposal({ plan, habit, report });

      resultado.push({
        ...plan,
        title: habit.title,
        rationale: text,
        rationaleSource: source,
        expiresAt: expiresAt.toISOString(),
        token,
      });
    }

    return resultado;
  }

  async confirmProposal(userId: string, token: string): Promise<RescheduleResult> {
    return this.proposals.confirm(userId, token);
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
