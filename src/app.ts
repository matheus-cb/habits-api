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
    origin: env.CORS_ORIGIN,
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

// Servidor MCP, para assistente externo. Fora de /api/v1 de propósito: não é REST
// e não versiona junto com a API HTTP.
//
// Por IP, contra enxurrada sem token. O teto POR USUÁRIO — o que contém o vetor
// real da primitiva `query` — está dentro do router, depois do `authenticate`.
app.use('/mcp', limitarTaxa({ janelaMs: 60_000, maximo: 120, nome: 'o MCP' }), createMcpRouter());

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
