import { env } from '@/config/env';
import { assistantRepository } from '@/repositories/assistant.repository';

/**
 * Teto diário de tokens de saída, por usuário.
 *
 * ## Por que isto é pré-requisito e não melhoria
 *
 * Um laço de ferramentas dá várias voltas por mensagem, e cada volta é uma chamada
 * paga. Um modelo que decide consultar dez vezes custa dez vezes. Sem teto, o
 * custo é ilimitado **por construção** — e quem paga a conta não é quem conversa.
 *
 * Foi por isso que eu declarei limite de custo e log de execução como
 * obrigatórios no dia em que houvesse superfície de chat. Enquanto o cliente era o
 * Claude Code, o custo era da assinatura de quem conversava e o registro era dele.
 *
 * ## Por que SAÍDA e não entrada
 *
 * Saída custa cerca de cinco vezes mais, e é a que o laço multiplica: a entrada
 * cresce com o histórico, a saída cresce com o número de voltas.
 *
 * ## Por que "dia" é UTC
 *
 * Mesma razão de INV-04: o servidor resolve o dia em UTC em todo lugar. Um teto
 * que virasse à meia-noite local e um histórico que conta em UTC discordariam
 * durante três horas por dia.
 */
export interface EstadoDoOrcamento {
  /** Tokens de saída hoje. Relevante para o motor da API. */
  gastoHoje: number;
  teto: number;
  restante: number;
  /** Dólares hoje. Relevante para o motor CLI, que cobra por volta. */
  custoHoje: number;
  tetoDeCusto: number;
  excedido: boolean;
  /** Qual dos dois estourou. `null` quando nenhum. */
  motivo: 'tokens' | 'custo' | null;
}

export async function orcamentoDoDia(userId: string): Promise<EstadoDoOrcamento> {
  const inicioDoDiaUtc = new Date();
  inicioDoDiaUtc.setUTCHours(0, 0, 0, 0);

  const { saida, custo } = await assistantRepository.consumoDesde(userId, inicioDoDiaUtc);
  const teto = env.ASSISTANT_DAILY_OUTPUT_TOKENS;
  const tetoDeCusto = env.ASSISTANT_DAILY_COST_USD;

  // `>=` e não `>`: atingir o teto exatamente já é tê-lo consumido. Com `>`, a
  // última mensagem sempre passaria, e o teto seria "o teto mais uma mensagem".
  const estourouTokens = saida >= teto;
  const estourouCusto = custo >= tetoDeCusto;

  return {
    gastoHoje: saida,
    teto,
    restante: Math.max(0, teto - saida),
    custoHoje: custo,
    tetoDeCusto,
    excedido: estourouTokens || estourouCusto,
    // Os DOIS tetos valem para os dois motores, e o motivo é declarado porque a
    // pessoa precisa saber qual bateu: "gastei muito token" e "gastei muito
    // dinheiro" pedem ações diferentes. O de custo é o que morde no motor CLI,
    // onde uma pergunta de 280 tokens de saída custou $0.16 — contar saída ali
    // mediria a coisa errada por uma ordem de grandeza.
    motivo: estourouCusto ? 'custo' : estourouTokens ? 'tokens' : null,
  };
}
