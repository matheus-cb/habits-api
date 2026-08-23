import type { IncomingHttpHeaders } from 'node:http';

/**
 * A marca que distingue escrita feita pelo assistente da feita pela pessoa.
 *
 * `createdVia` existia no schema, no repositório e nos dois services — com
 * comentário explicando que a origem "vem de quem chama no servidor, nunca do
 * corpo". O que não existia era **alguém passando `'assistant'`**: todo caminho
 * usava o default, e a coluna registrava `'user'` para tudo, inclusive para o que
 * o MCP criava. Uma coluna de auditoria que não distingue nada.
 *
 * ## Por que um cabeçalho, e por que ele pode ser falsificado
 *
 * A primitiva `request` chama a própria API pelo loopback, então o cabeçalho é o
 * único canal disponível — e um cliente HTTP qualquer também pode mandá-lo.
 *
 * A assimetria é o que torna isso aceitável, e ela precisa ser dita:
 *
 * - **Sub-registrar é impossível.** O gateway acrescenta o cabeçalho em toda
 *   chamada, e o cliente MCP não tem como removê-lo — ele nem monta a requisição
 *   HTTP. Escrita do assistente registrada como `'user'` não pode acontecer.
 * - **Sobre-registrar é possível.** Alguém com o token pode mandar o cabeçalho na
 *   mão e marcar como `'assistant'` algo que digitou. É auto-infligido e inócuo:
 *   atribui à IA um registro que é da pessoa.
 *
 * A direção que importa para auditoria é a primeira, e ela está fechada. Fechar a
 * segunda exigiria um canal que não passa pelo HTTP — e aí a primitiva deixaria
 * de reusar o middleware de validação, que é o motivo de ela existir.
 */
export const CABECALHO_DE_ORIGEM = 'x-habits-origem';

export type Origem = 'user' | 'assistant';

/**
 * Recebe só os CABEÇALHOS, não a `Request`.
 *
 * Tipar o parâmetro como `Request` do Express amarraria esta função aos genéricos
 * de params e body de cada controller — que são diferentes em cada rota, e o
 * `tsc` recusa a conversão. Cabeçalho é tudo o que ela lê, então é tudo o que ela
 * pede: assinatura estreita, sem cast em nenhum chamador.
 */
export function origemDaRequisicao(req: { headers: IncomingHttpHeaders }): Origem {
  return req.headers[CABECALHO_DE_ORIGEM] === 'assistant' ? 'assistant' : 'user';
}
