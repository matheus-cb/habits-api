/**
 * Jest configuration for unit tests.
 *
 * Unit tests run without a real database. The @/config/database module is
 * replaced with a stub, and required env vars are seeded via setupFiles.
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run the dedicated unit test files
  testMatch: [
    '<rootDir>/tests/helpers.test.ts',
    '<rootDir>/tests/stats.service.test.ts',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // Set env vars before any module is loaded (runs in the same process)
  setupFiles: ['<rootDir>/tests/unit-env-setup.js'],
  // No setupFilesAfterEach – unit tests don't touch the database
  moduleNameMapper: {
    // Replace real Prisma client with a stub
    '^@/config/database$': '<rootDir>/tests/__mocks__/database.ts',
    // Standard path aliases
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
