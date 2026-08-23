import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { registrarEnderecoLocal } from './mcp/endereco';

const PORT = parseInt(env.PORT, 10);

async function startServer() {
  try {
    // Test database connection
    await connectDatabase();
    logger.info('✅ Database connected successfully');

    // Start server
    const servidor = app.listen(PORT, () => {
      // A primitiva `request` do MCP chama a própria API pelo loopback, e precisa
      // do endereço OBSERVADO, não do pedido. Ver `mcp/endereco.ts`.
      registrarEnderecoLocal(servidor);
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📚 API Docs available at http://localhost:${PORT}/api-docs`);
      logger.info(`🏥 Health check at http://localhost:${PORT}/health`);
      logger.info(`🌍 Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('⚠️  SIGINT signal received: closing HTTP server');
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('⚠️  SIGTERM signal received: closing HTTP server');
  await disconnectDatabase();
  process.exit(0);
});

startServer();
