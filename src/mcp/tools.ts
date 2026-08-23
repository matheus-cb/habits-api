import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// `zod/v4`, e não `zod`, de propósito. O SDK do MCP (1.30) é tipado contra a
// API v4 do Zod; passando esquemas da v3 clássica (o export default do
// zod@3.25), a resolução de overload do `registerTool` fica profunda o bastante
// para estourar o heap do tsc com TS2589. O resto do projeto segue na v3 — as
// duas convivem no mesmo pacote, e este é o único arquivo que fala com o SDK.
import { z } from 'zod/v4';
import { ReadOnlyHabitsGateway } from './gateway';

/**
 * Tools MCP — todas somente leitura (INV-17).
 *
 * Este servidor existe para um assistente **externo** (Claude Desktop, Claude
 * Code) consultar hábitos e estatísticas. Ele não é consumido pela própria API:
 * servidor e cliente no mesmo processo faria a API chamar a si mesma pelo
 * protocolo, que é a armadilha que o NotaFlow documentou quando o Billing era
 * cliente do MCP do Inventory.
 *
 * Três camadas garantem que nada aqui escreve:
 * 1. o `ReadOnlyHabitsGateway` não tem método de escrita — o tipo é a barreira;
 * 2. `readOnlyHint: true` e `openWorldHint: false` declaram a intenção ao cliente;
 * 3. `TOOLS_SOMENTE_LEITURA` é a lista fechada que o teste de INV-17 confere,
 *    para que uma tool nova não entre sem alguém decidir por isso.
 */

/** Nomes registrados. Um nome fora desta lista reprova o teste de INV-17. */
export const TOOLS_SOMENTE_LEITURA = [
  'list_habits',
  'get_habit',
  'get_habit_stats',
  'list_checkins',
  'get_adherence_report',
] as const;

const ANOTACOES_DE_LEITURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerReadOnlyTools(
  server: McpServer,
  gateway: ReadOnlyHabitsGateway,
  userId: string
): void {
  server.registerTool(
    'list_habits',
    {
      title: 'Listar hábitos',
      description: 'Lista os hábitos da pessoa autenticada, com os dias agendados de cada um.',
      annotations: ANOTACOES_DE_LEITURA,
    },
    async () => json(await gateway.listHabits(userId))
  );

  server.registerTool(
    'get_habit',
    {
      title: 'Detalhar hábito',
      description:
        'Devolve um hábito por id. Falha se o hábito não pertencer à pessoa autenticada.',
      inputSchema: { habitId: z.string().uuid() },
      annotations: ANOTACOES_DE_LEITURA,
    },
    async ({ habitId }) => json(await gateway.getHabit(userId, habitId))
  );

  server.registerTool(
    'get_habit_stats',
    {
      title: 'Estatística de um hábito',
      description:
        'Aderência, sequência atual e melhor sequência de um hábito. Todos os números são calculados no servidor.',
      inputSchema: { habitId: z.string().uuid() },
      annotations: ANOTACOES_DE_LEITURA,
    },
    async ({ habitId }) => json(await gateway.getStats(userId, habitId))
  );

  server.registerTool(
    'list_checkins',
    {
      title: 'Listar check-ins',
      description: 'Check-ins de um hábito, do mais recente para o mais antigo.',
      inputSchema: {
        habitId: z.string().uuid(),
        limit: z.number().int().min(1).max(365).optional(),
      },
      annotations: ANOTACOES_DE_LEITURA,
    },
    async ({ habitId, limit }) => json(await gateway.listCheckins(userId, habitId, limit ?? 90))
  );

  server.registerTool(
    'get_adherence_report',
    {
      title: 'Relatório de aderência',
      description:
        'Relatório determinístico de aderência de todos os hábitos: taxa por hábito, dias da semana mais falhados e sequências em risco.',
      annotations: ANOTACOES_DE_LEITURA,
    },
    async () => json(await gateway.getAdherenceReport(userId))
  );
}

function json(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}
