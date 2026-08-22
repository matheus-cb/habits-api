// Provide minimal valid environment variables for unit tests that do not
// require a real database connection.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/habits_test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'unit-test-secret-key-that-is-at-least-32-chars';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
process.env.NODE_ENV = 'test';

// Vários casos exercitam caminhos que registram aviso de propósito (fallback de
// IA, redação reprovada). Silenciar abaixo de `error` mantém a saída da suíte
// legível sem esconder falha real.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
