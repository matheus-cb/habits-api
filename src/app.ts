import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';

import { env } from './config/env';
import { checkDatabase } from './config/database';
import { requestLogger } from './middlewares/logger.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { setupSwagger } from './docs/swagger';
import routes from './routes';
import { createMcpRouter } from './mcp/server';
import { errorResponse, successResponse } from './utils/response';
import { limitarTaxa } from './middlewares/rate-limit.middleware';

const app: Express = express();

// Security middlewares
app.use(helmet());
app.use(
  cors({
    /**
     * Vírgula separa origens, e uma só continua funcionando.
     *
     * `CORS_ORIGIN` era uma origem única, e o dashboard mudou de porta: o `.env`
     * dizia `localhost:3001` e o dev server subia em `3010`. O navegador
     * bloqueava o login com uma mensagem sobre CORS — que é a mensagem certa e
     * aponta para a configuração, não para o código.
     *
     * Isto não aparecia no container porque `CORS_ORIGIN` **não chegava lá**: era
     * uma das duas variáveis que o gate de INV-37 achou faltando no compose. No
     * container o Zod caía em `*` e tudo passava; no host a variável existia e
     * estava errada. Dois ambientes, dois comportamentos, nenhum aviso.
     *
     * Lista e não `*`: `*` com `credentials: true` é recusado pelo próprio
     * navegador, e afrouxar para resolver um erro de porta seria trocar um
     * problema visível por um invisível.
     */
    origin: env.CORS_ORIGIN.split(',').map((origem) => origem.trim()),
    credentials: true,
  })
);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(requestLogger);

// API Documentation
setupSwagger(app);

// Health check
//
// Consulta o banco de propósito. A versão anterior só respondia 200 se o processo
// estivesse vivo, e isso produziu um verde falso caro: o container do CI subiu sem
// nenhuma tabela (as migrações não estavam versionadas), reportou `healthy` para o
// `docker compose --wait`, e só o smoke descobriu — com 500 em toda rota de dado.
//
// Healthcheck que não toca a dependência crítica é teste de liveness vendido como
// readiness. Aqui a pergunta é "esta instância consegue atender?", e sem banco a
// resposta é não.
app.get('/health', async (_req, res) => {
  const database = await checkDatabase();
  const corpo = {
    status: database.ok ? 'healthy' : 'unhealthy',
    database: database.ok ? 'up' : database.reason,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  // O 503 sai em envelope de ERRO, não de sucesso. Antes ia em
  // `successResponse` com `status: 'unhealthy'` dentro — um cliente que confia no
  // envelope leria sucesso enquanto o corpo dizia o contrário.
  return database.ok
    ? res.status(200).json(successResponse(corpo))
    : res.status(503).json(errorResponse('unhealthy', JSON.stringify(corpo)));
});

// Limite de taxa antes das rotas, e DEPOIS do /health de propósito: monitoração
// batendo de segundo em segundo não deve consumir o teto de ninguém.
//
// Aqui o `authenticate` ainda não rodou, então este teto é POR IP — ele contém
// enxurrada não autenticada, que teto por usuário não poderia conter. Folgado
// porque atrás de NAT ele é compartilhado, e porque a primitiva `request` do MCP
// passa por aqui pelo loopback: um assistente compondo várias chamadas para
// responder uma pergunta é uso normal.
app.use('/api/v1', limitarTaxa({ janelaMs: 60_000, maximo: 300, nome: 'a API' }), routes);

// A superfície RESTRITA do assistente vem ANTES da completa, e a ordem é a
// garantia.
//
// `app.use('/mcp', …)` casa com QUALQUER caminho sob `/mcp`. Montada depois, esta
// rota só seria alcançada por o router completo não ter rota para `/assistente` —
// garantia por ausência, que uma rota nova lá dentro apagaria sem ninguém notar.
// Antes, ela ganha por precedência.
//
// Rota separada e não um parâmetro na mesma: parâmetro seria uma verificação em
// tempo de execução decidindo se a escrita existe, e o ponto do desenho é a
// escrita NÃO existir. Ver `PerfilMcp` em `mcp/server.ts`.
app.use(
  '/mcp/assistente',
  limitarTaxa({ janelaMs: 60_000, maximo: 600, nome: 'o MCP do assistente' }),
  createMcpRouter(undefined, { perfil: 'assistente' })
);

// Servidor MCP completo, para assistente externo (Claude Code, Claude Desktop).
// Fora de /api/v1 de propósito: não é REST e não versiona junto com a API HTTP.
//
// Por IP, contra enxurrada sem token. O teto POR USUÁRIO — o que contém o vetor
// real da primitiva `query` — está dentro do router, depois do `authenticate`.
//
// 600 e não 120: num serviço acessado pelo loopback, teto por IP é teto do
// PROCESSO — ele não separa ninguém de ninguém, e a primitiva `request` gera
// tráfego que compete com o orçamento de quem conversa. Apertá-lo pune uso
// legítimo sem conter nada que o teto por usuário já não contenha. O teste de
// rajada do smoke (70 chamadas) esgotava 120 e fazia a execução SEGUINTE falhar
// inteira dentro do mesmo minuto.
app.use('/mcp', limitarTaxa({ janelaMs: 60_000, maximo: 600, nome: 'o MCP' }), createMcpRouter());

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
  });
});

// Error handler (must be last)
app.use(errorHandler);

export { app };
