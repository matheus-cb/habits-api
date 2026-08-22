import { aiConfigured } from '@/config/env';
import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { AdherenceService } from './adherence.service';
import { InsightsService } from './insights.service';
import { AnthropicNarrator } from './narrator.anthropic';
import { DeterministicNarrator } from './narrator.deterministic';
import { ProposalService } from './proposal.service';

/**
 * Montagem da camada de insights.
 *
 * `aiConfigured()` é consultado uma vez, aqui. Nenhum outro arquivo pergunta se
 * existe chave — quem decide é a composição, e o resto do código só conhece a
 * interface `Narrator`. É o que impede que a fronteira de INV-15 se dissolva em
 * `if (env.ANTHROPIC_API_KEY)` espalhados pelo service.
 */
export function createInsightsService(): InsightsService {
  const habitsRepository = new HabitsRepository();
  const checkinsRepository = new CheckinsRepository();

  return new InsightsService(
    new AdherenceService(habitsRepository, checkinsRepository),
    new ProposalService(habitsRepository),
    aiConfigured() ? new AnthropicNarrator() : null,
    new DeterministicNarrator()
  );
}

export * from './adherence.types';
