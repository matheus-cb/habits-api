import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from '@/middlewares/auth.middleware';
import { limitarTaxa } from '@/middlewares/rate-limit.middleware';
import { logger } from '@/utils/logger';
import { swaggerDocument } from '@/docs/swagger';
import { createHabitsGateway, ReadOnlyHabitsGateway } from './gateway';
import { registerReadOnlyTools } from './tools';
import { registrarFechamento } from './fechamentos';
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
  // `criarGatewayDeQuery()` no parâmetro default é avaliado quando ESTA função é
  // chamada — uma vez, na montagem do app — e não por requisição. A posição é
  // deliberada: o corpo de `router.post` cria `McpServer`, transporte e
  // `gatewayFactory()` a cada chamada, e mover o gateway de query para lá
  // criaria um `PrismaClient` com pool próprio por requisição, esgotando o
  // Postgres em minutos. Uniformizar isto é a refatoração a não fazer.
  const router = Router();

  router.use(authenticate);

  // DEPOIS do `authenticate`, então chaveia por usuário — e é este o teto que
  // contém o vetor real: `query` executa SQL arbitrário, e um laço fechado
  // manteria o Postgres ocupado indefinidamente sem nenhum bug. O
  // `connection_limit=2` do pool da role cobre simultaneidade; isto cobre
  // frequência. Um assistente trabalhando faz dezenas de chamadas por pergunta,
  // então 60/min contém laço sem atrapalhar uso.
  router.use(limitarTaxa({ janelaMs: 60_000, maximo: 60, nome: 'o MCP' }));

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
          'Escrita é reversível por construção, e por dois mecanismos: apagar é LÓGICO e volta',
          'por `/restore`; editar grava a versão anterior em `habit_revisions` e volta por',
          '`/revisions/:revisionId/restore`. Isso é rede de segurança, não licença para',
          'escrever e ver o que acontece — o apagamento definitivo é um script que só a pessoa',
          'roda, e não existe como rota.',
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
    //
    // O `close` não pode ser aguardado aqui: o handler de `res.on('close')` é
    // síncrono e a requisição já terminou. Em produção isso é correto e não tem
    // consequência — o processo é longo e o fechamento completa em milissegundos.
    //
    // Em TESTE é diferente, e é por isso que as promessas são registradas. Com
    // `--runInBand` a suíte inteira roda num processo, e um `close` disparado no
    // fim de um arquivo completa no meio do seguinte — mexendo em socket ou
    // conexão enquanto outro teste usa a rede. `--detectOpenHandles` NÃO vê isso:
    // ele relata o que está aberto quando a suíte termina, e trabalho que dispara
    // e completa no meio não está aberto no fim.
    //
    // `aguardarFechamentos()` existe para o teardown poder esperar. Não muda o
    // comportamento de produção: lá ninguém chama.
    res.on('close', () => {
      registrarFechamento(
        Promise.allSettled([transport.close(), server.close()]).then(() => undefined)
      );
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
