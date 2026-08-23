/**
 * Camada 1 — testes que não dependem de serviço externo.
 *
 * Rodam em qualquer máquina e em qualquer sandbox de agente: o módulo
 * `@/config/database` é substituído por um stub e as variáveis de ambiente
 * obrigatórias são semeadas em `setupFiles`, antes de qualquer import.
 *
 * O testMatch é um diretório, não uma lista de arquivos: com a lista, um teste
 * novo em tests/unit/ ficava fora da suíte sem ninguém notar.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  setupFiles: ['<rootDir>/tests/unit-env-setup.js'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/server.ts', '!src/types/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  moduleNameMapper: {
    // Prisma real nunca é carregado na Camada 1.
    '^@/config/database$': '<rootDir>/tests/__mocks__/database.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@controllers/(.*)$': '<rootDir>/src/controllers/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@middlewares/(.*)$': '<rootDir>/src/middlewares/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@schemas/(.*)$': '<rootDir>/src/schemas/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
