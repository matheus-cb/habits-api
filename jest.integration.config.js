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
  // `forceExit` foi REMOVIDO, e o motivo importa mais que a linha.
  //
  // Ele existia porque o pool do Prisma mantinha handle vivo e a suíte ficava
  // pendurada sem output — indistinguível de suíte lenta. O comentário estava
  // certo sobre o sintoma e calado sobre o que `forceExit` faz: ele **não fecha o
  // que não fechou, ele para de esperar**. Um handle vazando continuava vazando, e
  // o trabalho assíncrono em voo era morto no meio.
  //
  // Isso o transformou no encobrimento de uma causa: com ele ligado, "existe
  // trabalho que ninguém aguarda" deixa de ter sintoma. É a mesma forma do
  // `.gitignore` que escondia migrações e do `pg_read_all_data` — decisão local
  // correta que apaga a informação de que há um problema maior.
  //
  // Hoje a condição não existe mais: `--detectOpenHandles` sem `forceExit` não
  // reporta nada e a suíte encerra sozinha em ~13s. Os `$disconnect` explícitos
  // dos clients dedicados (o cru dos testes e o da primitiva `query`) fecharam o
  // que faltava.
  //
  // Se ela voltar a pendurar: rode
  //   npx jest --config jest.integration.config.js --runInBand --detectOpenHandles
  // e feche o handle que aparecer. Não religue esta linha — religá-la devolve o
  // silêncio, não a correção.
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
