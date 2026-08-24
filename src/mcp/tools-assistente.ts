import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// `zod/v4` pelo mesmo motivo de `tools.ts`: o SDK do MCP é tipado contra a v4.
import { z } from 'zod/v4';
import { env } from '@/config/env';
import { assistantRepository } from '@/repositories/assistant.repository';
import { ForbiddenError, NotFoundError } from '@/utils/errors';
import { GatewayDeQuery } from './query';
import { ROTAS_PERMITIDAS } from './request';

/**
 * A superfície MCP do **assistente do dashboard**, e por que ela é separada.
 *
 * ## O problema que ela resolve, medido
 *
 * O chat do dashboard pode rodar sobre o CLI do Claude Code em modo headless
 * (`claude -p`), na assinatura de quem usa. Nesse modo **não há humano para
 * confirmar** — e o `request` da superfície completa EXECUTA a escrita na hora.
 *
 * A defesa óbvia seria `--allowedTools`. Ela não funciona, e isto foi medido: com
 * `--allowedTools "mcp__habits__query"`, o modelo chamou `request` e a chamada
 * chegou ao servidor. Só `--disallowedTools` bloqueia — e depender dela deixa
 * **tool nova nascer chamável**, que é exatamente a classe que INV-26 fechou para
 * rotas.
 *
 * Então a proteção é topológica: esta superfície **não tem** tool de escrita. Não
 * há o que permitir ou negar, e uma tool acrescentada em `tools.ts` ou
 * `primitivas.ts` não aparece aqui.
 *
 * ## `propor` em vez de `agir`
 *
 * Ela grava uma `PendingAction` e devolve o id. Nada é escrito. A pessoa aprova no
 * dashboard, e é o `AssistantService.decidir` que executa — pela allowlist,
 * conferida de novo naquele instante.
 *
 * ## De onde vem a conversa
 *
 * Do cabeçalho `x-habits-conversation`, posto pelo próprio servidor no arquivo de
 * configuração MCP que ele gera para o subprocesso. Não vem de argumento da tool:
 * se viesse, o modelo poderia propor ações numa conversa que não é a dele — a
 * mesma razão de o `userId` não ser argumento (INV-10).
 */
export const CABECALHO_DE_CONVERSA = 'x-habits-conversation';

/** Nomes desta superfície. Duas, e nenhuma escreve. */
export const TOOLS_DO_ASSISTENTE = ['consultar', 'propor'] as const;

export function registrarToolsDoAssistente(
  server: McpServer,
  {
    gatewayDeQuery,
    userId,
    conversationId,
  }: { gatewayDeQuery: GatewayDeQuery; userId: string; conversationId: string }
): void {
  server.registerTool(
    'consultar',
    {
      title: 'Consultar (SQL somente leitura)',
      description:
        'Executa um SELECT nos dados desta pessoa. A conexão usa um role sem permissão de ' +
        'escrita e as tabelas têm Row-Level Security por usuário — INSERT/UPDATE/DELETE falham ' +
        'por permissão do Postgres, e nenhuma consulta alcança dado de outra pessoa. Um comando ' +
        'por chamada. Colunas com maiúscula precisam de aspas duplas; `"deletedAt" IS NULL` é o ' +
        'filtro de "está ativo".',
      inputSchema: {
        sql: z.string().min(1).max(8000),
        motivo: z.string().min(3).max(200).describe('O que você quer descobrir.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sql }) => json(await gatewayDeQuery.executar(userId, sql))
  );

  server.registerTool(
    'propor',
    {
      title: 'Propor uma alteração (NÃO executa)',
      description:
        'Registra uma alteração para a pessoa aprovar. **Ela não acontece quando você chama.** ' +
        'A pessoa vê o seu `resumo` no dashboard e decide; se aprovar, a alteração é executada ' +
        'e você recebe o resultado. Uma proposta por vez. Rotas disponíveis:\n' +
        ROTAS_PERMITIDAS.filter((rota) => rota.escreve)
          .map((rota) => `- ${rota.metodo} ${rota.padrao} — ${rota.motivo}`)
          .join('\n'),
      inputSchema: {
        metodo: z.enum(['POST', 'PUT', 'DELETE']),
        path: z.string().min(1).describe('Começa com /api/v1. Sem host.'),
        corpo: z.unknown().optional(),
        resumo: z
          .string()
          .min(5)
          .max(300)
          .describe(
            'Uma frase dizendo o que isto muda para a pessoa. É o texto que ela lê para ' +
              'decidir — descreva o efeito, não a chamada HTTP.'
          ),
      },
      annotations: {
        // `readOnlyHint: true` seria mentira e `destructiveHint: true` também:
        // esta tool ESCREVE uma proposta e não altera nada do domínio. O par
        // honesto é "não é leitura, e não destrói".
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ metodo, path, corpo, resumo }) => {
      const conversa = await assistantRepository.acharConversa(conversationId);
      if (!conversa) throw new NotFoundError('Conversation');
      // Cinto e suspensório: o cabeçalho vem do servidor, mas conferir o dono
      // custa uma consulta e fecha o caso de um arquivo de configuração vazado.
      if (conversa.userId !== userId) throw new ForbiddenError('Esta conversa não é sua');

      if (!rotaPermitida(metodo, path)) {
        throw new ForbiddenError(
          `${metodo} ${path} não está no alcance do assistente. Só as rotas listadas na ` +
            'descrição desta tool podem ser propostas.'
        );
      }

      const acao = await assistantRepository.criarAcao({
        conversationId,
        // Sem `tool_use_id` do protocolo aqui: no modo CLI o laço é do Claude
        // Code e este id não volta para nós. O campo guarda o id da própria ação
        // para o histórico não ficar com string vazia — e o `decidir` do motor
        // CLI não depende dele.
        toolUseId: `cli:${conversationId}`,
        metodo,
        path,
        corpo: corpo === undefined ? null : JSON.stringify(corpo),
        resumo,
        expiresAt: new Date(Date.now() + env.ASSISTANT_ACTION_TTL_MINUTES * 60_000),
      });

      return json({
        proposta: acao.id,
        estado: 'aguardando a pessoa',
        aviso:
          'NADA foi alterado. A pessoa vai aprovar ou recusar no dashboard. Não proponha a ' +
          'mesma coisa de novo, e não afirme que a alteração aconteceu.',
      });
    }
  );
}

function rotaPermitida(metodo: string, path: string): boolean {
  const semQuery = path.split('?')[0] ?? path;
  if (!semQuery.startsWith('/') || semQuery.includes('..')) return false;

  return ROTAS_PERMITIDAS.some((rota) => {
    if (!rota.escreve || rota.metodo !== metodo) return false;
    const padrao = rota.padrao.split('/');
    const alvo = semQuery.replace(/\/+$/, '').split('/');
    if (padrao.length !== alvo.length) return false;
    return padrao.every((seg, i) =>
      seg.startsWith(':') ? (alvo[i]?.length ?? 0) > 0 : seg === alvo[i]
    );
  });
}

function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}
