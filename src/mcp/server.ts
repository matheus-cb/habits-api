import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from '@/middlewares/auth.middleware';
import { logger } from '@/utils/logger';
import { swaggerDocument } from '@/docs/swagger';
import { createHabitsGateway, ReadOnlyHabitsGateway } from './gateway';
import { registerReadOnlyTools } from './tools';
import { registrarPrimitivas, registrarRecursos } from './primitivas';
import { criarGatewayDeQuery, GatewayDeQuery } from './query';
import { GatewayDeRequest, HttpRequestGateway } from './request';

/**
 * Endpoint MCP, transporte Streamable HTTP, **sem sessão**.
 *
 * Um servidor e um transporte novos por requisição, amarrados ao `userId` do JWT
 * daquela requisição. É mais caro que manter uma sessão viva, e é deliberado: com
 * sessão, o `userId` ficaria guardado no servidor e um erro de roteamento
 * entregaria os hábitos de uma pessoa para outra. Aqui não há estado para
 * vazar — o escopo do usuário é fechado por closure na própria tool.
 *
 * A autenticação é o mesmo `authenticate` das rotas HTTP: o MCP não tem porta
 * própria de identidade (INV-10).
 */
export function createMcpRouter(
  gatewayFactory: () => ReadOnlyHabitsGateway = createHabitsGateway,
  {
    gatewayDeQuery = criarGatewayDeQuery(),
    gatewayDeRequest = new HttpRequestGateway(),
  }: { gatewayDeQuery?: GatewayDeQuery | null; gatewayDeRequest?: GatewayDeRequest } = {}
): Router {
  const router = Router();

  router.use(authenticate);

  router.post('/', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    // O token do cabeçalho, não um reemitido. A primitiva `request` chama a API
    // com a credencial de quem abriu esta sessão MCP: assinar um token novo aqui
    // daria ao assistente uma identidade que ninguém autenticou.
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

    const server = new McpServer(
      { name: 'habits-mcp', version: '1.0.0' },
      {
        instructions: [
          'Assistente sobre os hábitos da pessoa autenticada. Duas formas de trabalhar:',
          '',
          '1. As tools nomeadas (list_habits, get_habit_stats, get_adherence_report…) para o',
          '   que é rotina. Todas somente leitura.',
          '2. As primitivas `query` e `request` para o que não tem tool. `query` é SQL somente',
          '   leitura sobre os seus dados; `request` chama a API — inclusive escrevendo.',
          '',
          'Antes de compor uma consulta ou uma chamada, leia os recursos `habits://schema`,',
          '`habits://rotas` e `habits://contratos`: os três são gerados a partir do sistema real,',
          'e adivinhar nome de coluna, de rota ou de campo custa uma ida e volta.',
          '',
          'A regra que não se negocia: **você sugere, a pessoa decide.** Nenhuma chamada que',
          'altere estado sem ela ter concordado com aquela chamada. Todo número que você',
          'afirmar tem de vir de uma leitura — não estime, não arredonde de cabeça, não',
          'complete uma série que você não consultou.',
          '',
          'Escrita é reversível por construção: apagar hábito ou check-in é LÓGICO e volta por',
          '`/restore`. Isso é uma rede de segurança, não licença para apagar e ver o que',
          'acontece — o apagamento definitivo é um script que só a pessoa roda.',
        ].join('\n'),
      }
    );

    registerReadOnlyTools(server, gatewayFactory(), userId);
    registrarPrimitivas(server, { gatewayDeQuery, gatewayDeRequest, userId, token });
    registrarRecursos(server, { gatewayDeQuery, userId, openapi: swaggerDocument });

    const transport = new StreamableHTTPServerTransport({
      // Sem sessão: ver o comentário do arquivo.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Fechar os dois quando a resposta termina, inclusive em erro ou desconexão
    // do cliente — sem isto cada chamada deixa um servidor MCP pendurado.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('falha ao atender requisição MCP', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // GET e DELETE existem no transporte com sessão. Sem sessão eles não têm
  // significado, e responder 405 é mais honesto do que abrir um stream vazio.
  router.all('/', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null,
    });
  });

  return router;
}
