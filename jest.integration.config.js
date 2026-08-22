/**
 * Camada 2 — exige PostgreSQL de verdade em DATABASE_URL.
 *
 * `tests/setup.ts` apaga as três tabelas antes de cada teste. O banco vem de
 * `.env.test`, e `tests/setup.ts` RECUSA rodar se o nome não terminar em `_test`
 * — a primeira versão desta camada usava o `.env` de desenvolvimento, o que
 * apagaria os dados de quem estivesse desenvolvendo, em silêncio.
 *
 * Sem Postgres a suíte falha na conexão — é por isso que ela é uma camada
 * separada, e não parte da Camada 1: misturar as duas fazia `npm test` falhar
 * inteiro em máquina sem Docker, sem distinguir "quebrou" de "não pôde rodar".
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  // Carrega .env.test ANTES de qualquer import, para que `config/env.ts` leia o
  // banco de teste e não o .env de desenvolvimento. `override: true` é o ponto:
  // sem ele, um DATABASE_URL já exportado no shell venceria.
  setupFiles: ['<rootDir>/tests/integration-env-setup.js'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/server.ts', '!src/types/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  moduleNameMapper: {
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
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // O cliente do Prisma mantém o pool aberto depois do último teste e o jest não
  // encerra sozinho — ficava pendurado sem output nenhum, indistinguível de
  // suíte lenta. O `$disconnect` no afterAll não basta porque o pool do Prisma
  // ainda tem handle vivo.
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
