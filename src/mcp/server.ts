import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from '@/middlewares/auth.middleware';
import { logger } from '@/utils/logger';
import { createHabitsGateway, ReadOnlyHabitsGateway } from './gateway';
import { registerReadOnlyTools } from './tools';

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
  gatewayFactory: () => ReadOnlyHabitsGateway = createHabitsGateway
): Router {
  const router = Router();

  router.use(authenticate);

  router.post('/', async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const server = new McpServer(
      { name: 'habits-mcp', version: '1.0.0' },
      {
        instructions:
          'Servidor somente leitura sobre os hábitos da pessoa autenticada. Nenhuma tool altera estado: check-in, criação e reagendamento acontecem apenas na API HTTP, com confirmação da pessoa.',
      }
    );

    registerReadOnlyTools(server, gatewayFactory(), userId);

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
