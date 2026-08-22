import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';

import { env } from './config/env';
import { requestLogger } from './middlewares/logger.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { setupSwagger } from './docs/swagger';
import routes from './routes';
import { createMcpRouter } from './mcp/server';
import { successResponse } from './utils/response';

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
app.get('/health', (_req, res) => {
  res.status(200).json(
    successResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  );
});

// API Routes
app.use('/api/v1', routes);

// Servidor MCP somente leitura, para assistente externo. Fora de /api/v1 de
// propósito: não é REST e não versiona junto com a API HTTP.
app.use('/mcp', createMcpRouter());

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
