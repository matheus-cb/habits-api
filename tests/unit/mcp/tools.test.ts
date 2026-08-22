import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerReadOnlyTools, TOOLS_SOMENTE_LEITURA } from '@/mcp/tools';
import { ReadOnlyHabitsGateway } from '@/mcp/gateway';
import { adherenceReport } from '../insights/fixtures';

const USER_ID = 'user-1';
const OUTRO_USUARIO = 'user-2';
const HABIT_UUID = '11111111-1111-4111-8111-111111111111';

function gatewayFalso(): jest.Mocked<ReadOnlyHabitsGateway> {
  const habit = {
    id: 'habit-1',
    title: 'Correr',
    description: null,
    scheduledDays: [1, 3, 5],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    listHabits: jest.fn().mockResolvedValue([habit]),
    getHabit: jest.fn().mockResolvedValue(habit),
    getStats: jest.fn().mockResolvedValue({ completionRate: 50 }),
    listCheckins: jest.fn().mockResolvedValue([{ id: 'c1', date: '2026-08-22' }]),
    getAdherenceReport: jest.fn().mockResolvedValue(adherenceReport()),
  };
}

/**
 * Sobe servidor e cliente MCP ligados por transporte em memória.
 *
 * O teste fala o protocolo de verdade — `listTools` e `callTool` — em vez de
 * espiar o registro interno do servidor. Espiar o interno testaria a versão
 * atual do SDK; falar o protocolo testa o que um assistente externo realmente vê.
 */
async function conectar(gateway = gatewayFalso(), userId = USER_ID) {
  const server = new McpServer({ name: 'habits-mcp-teste', version: '0.0.0' });
  registerReadOnlyTools(server, gateway, userId);

  const client = new Client({ name: 'cliente-de-teste', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    gateway,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe('INV-17 — as tools MCP são somente leitura', () => {
  it('INV-17: as tools anunciadas são exatamente a lista fechada', async () => {
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOLS_SOMENTE_LEITURA].sort());
    } finally {
      await close();
    }
  });

  it('INV-17: adversário — nenhuma tool anunciada tem nome de escrita', async () => {
    // Se alguém registrar `create_checkin` ou `update_habit`, este caso cai antes
    // de o servidor chegar a produção. É a defesa contra a tool "só de
    // conveniência" que aparece seis meses depois.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      const proibidos = /^(create|update|delete|patch|put|set|apply|confirm|mark|remove)_/;

      expect(tools.map((tool) => tool.name).filter((nome) => proibidos.test(nome))).toEqual([]);
    } finally {
      await close();
    }
  });

  it('INV-17: toda tool anuncia readOnlyHint e nega destructiveHint e openWorldHint', async () => {
    // É por estas anotações que um cliente MCP decide se pode chamar a tool sem
    // confirmação. Anunciar errado seria pior do que não anunciar.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(TOOLS_SOMENTE_LEITURA.length);

      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        });
      }
    } finally {
      await close();
    }
  });

  it('INV-17: adversário — chamar uma tool de escrita inexistente é erro, não silêncio', async () => {
    const { client, close } = await conectar();
    try {
      const resultado = await client
        .callTool({ name: 'create_checkin', arguments: { habitId: HABIT_UUID } })
        .catch((erro: unknown) => erro);

      // Ou o SDK rejeita, ou devolve isError — nunca sucesso.
      const sucesso =
        typeof resultado === 'object' &&
        resultado !== null &&
        'content' in resultado &&
        (resultado as { isError?: boolean }).isError !== true;
      expect(sucesso).toBe(false);
    } finally {
      await close();
    }
  });

  it('INV-17: adversário — o gateway não expõe nenhum método de escrita', () => {
    // A anotação declara a intenção; o TIPO é o que torna a escrita inalcançável.
    // Se `ReadOnlyHabitsGateway` ganhar um método de escrita, este caso cai.
    const metodos = Object.keys(gatewayFalso()).sort();

    expect(metodos.filter((metodo) => /create|update|delete|save|write|remove|set/i.test(metodo))).toEqual(
      []
    );
    expect(metodos).toEqual([
      'getAdherenceReport',
      'getHabit',
      'getStats',
      'listCheckins',
      'listHabits',
    ]);
  });

  it('INV-17: adversário — o arquivo de tools não importa service nem repositório', () => {
    // Import de `HabitsService` ou de um repositório aqui abriria caminho para
    // escrita sem passar pelo gateway. O teste é estático de propósito: um import
    // desses não quebra nada em execução, só destrói a barreira.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'mcp', 'tools.ts'),
      'utf8'
    );

    expect(fonte).not.toMatch(/from\s+'@\/services\//);
    expect(fonte).not.toMatch(/from\s+'@\/repositories\//);
    expect(fonte).not.toMatch(/ProposalService|InsightsService/);
  });
});

describe('INV-03/INV-10 — o MCP não tem porta própria de identidade', () => {
  it('INV-03: adversário — userId no argumento da tool é ignorado', async () => {
    // O ataque: uma tool que aceitasse userId permitiria a um assistente pedir os
    // hábitos de outra pessoa. O id vem do JWT no momento do registro e está
    // fechado por closure — o argumento não tem para onde ir.
    const { client, gateway, close } = await conectar(gatewayFalso(), USER_ID);
    try {
      await client.callTool({ name: 'list_habits', arguments: { userId: OUTRO_USUARIO } });

      expect(gateway.listHabits).toHaveBeenCalledWith(USER_ID);
      expect(gateway.listHabits).not.toHaveBeenCalledWith(OUTRO_USUARIO);
    } finally {
      await close();
    }
  });

  it('INV-03: nenhuma tool declara userId no seu schema de entrada', async () => {
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        const propriedades = Object.keys(
          (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
        );
        expect(propriedades).not.toContain('userId');
      }
    } finally {
      await close();
    }
  });

  it('INV-03: get_habit repassa o hábito pedido junto com o dono do token', async () => {
    const { client, gateway, close } = await conectar(gatewayFalso(), USER_ID);
    try {
      await client.callTool({ name: 'get_habit', arguments: { habitId: HABIT_UUID } });

      expect(gateway.getHabit).toHaveBeenCalledWith(USER_ID, HABIT_UUID);
    } finally {
      await close();
    }
  });

  it('INV-03: adversário — habitId que não é uuid é recusado pelo schema, não repassado', async () => {
    const { client, gateway, close } = await conectar();
    try {
      await client
        .callTool({ name: 'get_habit', arguments: { habitId: "'; DROP TABLE habits; --" } })
        .catch(() => undefined);

      expect(gateway.getHabit).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('INV-13: get_adherence_report devolve o relatório determinístico, sem passar por modelo', async () => {
    const { client, gateway, close } = await conectar();
    try {
      const resultado = (await client.callTool({ name: 'get_adherence_report' })) as {
        content: { type: string; text: string }[];
      };

      expect(gateway.getAdherenceReport).toHaveBeenCalledWith(USER_ID);
      expect(JSON.parse(resultado.content[0]!.text)).toEqual(
        JSON.parse(JSON.stringify(adherenceReport()))
      );
    } finally {
      await close();
    }
  });
});
