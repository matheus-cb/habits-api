import { AdherenceReport, FallbackReason, HabitAdherence } from './adherence.types';
import { ReschedulePlan } from './reschedule.engine';

/**
 * Contrato de redação.
 *
 * INV-15 é estrutural e não um `if` no meio do service: existem dois
 * implementadores com a mesma assinatura, e quem chama não sabe qual recebeu. Se
 * a chave sai do ambiente, o determinístico entra e o endpoint responde igual —
 * com `source` diferente, que é a única coisa que o usuário precisa saber.
 */
export interface Narrator {
  /** Identifica quem redigiu, para a resposta HTTP. */
  readonly source: 'model' | 'deterministic';

  /**
   * Redige o resumo do relatório.
   *
   * Recebe o relatório **fechado** e devolve texto. Não recebe repositório, não
   * recebe o usuário e não tem como consultar nada: a única entrada é o que já
   * foi calculado (INV-13).
   *
   * Lança `NarrationFailure` quando não conseguiu redigir. Quem chama trata
   * caindo para o determinístico — nunca propagando erro de IA para o usuário.
   */
  narrate(report: AdherenceReport): Promise<string>;

  /**
   * Redige a justificativa de uma proposta de reagendamento.
   *
   * Recebe o plano **já decidido** pelo motor determinístico. O redator explica
   * uma escolha que não é dele; ele não pode alterar os dias, porque os dias não
   * fazem parte do que ele devolve (INV-18).
   */
  narrateProposal(input: ProposalNarrationInput): Promise<string>;
}

export interface ProposalNarrationInput {
  plan: ReschedulePlan;
  habit: HabitAdherence;
  /** Usado apenas como conjunto permitido pelo guarda numérico (INV-14). */
  report: AdherenceReport;
}

/**
 * Falha de redação, com motivo em uma palavra.
 *
 * O motivo é o que vai para a resposta e para o log. Nunca a mensagem do
 * provedor, o prompt ou o raciocínio do modelo (INV-16) — mensagem de erro de
 * provedor é lugar comum de vazamento de trecho de prompt.
 */
export class NarrationFailure extends Error {
  constructor(public readonly reason: FallbackReason) {
    super(reason);
    this.name = 'NarrationFailure';
  }
}
