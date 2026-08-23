import { z } from 'zod';
import { ROTAS_PERMITIDAS } from '@/mcp/request';

/**
 * As duas ferramentas que o assistente conversacional vê.
 *
 * São as mesmas primitivas do MCP, com **uma diferença que é o desenho inteiro**:
 * `agir` não executa. Ela devolve uma proposta que a pessoa aprova, e só então o
 * servidor a executa pela allowlist.
 *
 * ## Por que primitivas e não uma tool por operação
 *
 * Uma tool por operação limita o assistente ao que alguém antecipou. O valor está
 * nas perguntas que ninguém previu — "em que dia da semana eu mais falho no
 * hábito que criei em março?" não é uma tool, é uma consulta. Com duas primitivas
 * o alcance é composição, e rota nova entra sem código novo.
 *
 * ## Por que `agir` não executa, ao contrário do MCP
 *
 * No MCP o cliente é o Claude Code, que **tem o próprio mecanismo de
 * confirmação**: ele mostra a chamada e espera aprovação antes de executar. Aqui o
 * cliente é o dashboard, e não há esse mecanismo — se `agir` executasse, o modelo
 * decidiria sozinho, e "a decisão é do usuário" viraria promessa do prompt. Prompt
 * não é garantia.
 *
 * Então a fronteira migrou de onde ela estava para onde ela precisa estar: uma
 * linha em `pending_actions` que só um ato explícito converte em escrita.
 */

export const CONSULTAR = 'consultar';
export const AGIR = 'agir';

export const esquemaConsultar = z.object({
  sql: z
    .string()
    .min(1)
    .max(8000)
    .describe('Um único SELECT. Sem ponto e vírgula extra, sem múltiplos comandos.'),
  motivo: z
    .string()
    .min(3)
    .max(200)
    .describe('O que você está tentando descobrir. Aparece na interface para a pessoa acompanhar.'),
});

export const esquemaAgir = z.object({
  metodo: z.enum(['POST', 'PUT', 'DELETE']),
  path: z.string().min(1).describe('Começa com /api/v1. Sem host.'),
  corpo: z.unknown().optional().describe('JSON do corpo, quando a rota pedir.'),
  resumo: z
    .string()
    .min(5)
    .max(300)
    .describe(
      'Uma frase em português dizendo o que isto muda, do ponto de vista da pessoa. ' +
        'É o texto que ela vai ler para decidir — não descreva a chamada HTTP, descreva o efeito.'
    ),
});

/**
 * A descrição da ferramenta de escrita, com a lista de rotas EMBUTIDA.
 *
 * Embutida e derivada: o modelo precisa saber o que pode pedir, e a lista vem da
 * mesma constante que o servidor confere na aprovação. Uma lista escrita à mão na
 * descrição divergiria da lista que decide — e o modelo pediria coisas que são
 * recusadas, ou deixaria de pedir coisas permitidas.
 */
export function descreverRotasDeEscrita(): string {
  return ROTAS_PERMITIDAS.filter((rota) => rota.escreve)
    .map((rota) => `- ${rota.metodo} ${rota.padrao} — ${rota.motivo}`)
    .join('\n');
}

export function descreverRotasDeLeitura(): string {
  return ROTAS_PERMITIDAS.filter((rota) => !rota.escreve)
    .map((rota) => `- ${rota.metodo} ${rota.padrao} — ${rota.motivo}`)
    .join('\n');
}
