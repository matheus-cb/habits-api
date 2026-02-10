# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
- `npm run dev` - Start development server with hot reload (uses tsx watch)
- `npm run build` - Build for production (outputs to `dist/`)
- `npm start` - Start production server from built files

### Testing
- `npm test` - Run all tests with Jest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate coverage report

### Code Quality
- `npm run lint` - Check TypeScript files for lint errors
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier

### Database (Prisma)
- `npm run prisma:generate` - Generate Prisma Client (run after schema changes)
- `npm run prisma:migrate` - Create and apply new migration
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:seed` - Seed database with sample data

### Docker
- `npm run docker:up` - Start PostgreSQL container
- `npm run docker:down` - Stop containers

## Architecture Overview

This is a habits tracking API built with **Clean Architecture** principles and layered design:

### Layer Structure
```
Routes → Controllers → Services → Repositories → Database (Prisma/PostgreSQL)
          ↓
      Middlewares (auth, validation, error handling)
```

### Key Architectural Patterns

**Repository Pattern**: All database access is abstracted through repositories (`src/repositories/`). Services never interact directly with Prisma.

**Service Layer**: Business logic lives in services (`src/services/`). Controllers are thin and only handle HTTP concerns.

**Dependency Injection**: Controllers receive services as constructor parameters, services receive repositories. This enables testing with mocks.

**Error Handling**: Custom error classes in `src/utils/errors.ts` (AppError, BadRequestError, UnauthorizedError, NotFoundError, ConflictError, ValidationError). All errors are caught by the global error handler middleware.

### Request Flow
1. Request hits route in `src/routes/`
2. Auth middleware (`src/middlewares/auth.middleware.ts`) validates JWT and attaches `req.user`
3. Validation middleware checks request body against Zod schema
4. Controller receives request, calls service
5. Service executes business logic, calls repository
6. Repository queries database via Prisma
7. Response flows back through layers
8. Error middleware catches any thrown errors

## Database Schema

Three main models with cascade deletes:

**User** (id, name, email, password)
- Has many Habits

**Habit** (id, title, description, userId)
- Belongs to User
- Has many Checkins
- Cascade deletes when User is deleted

**Checkin** (id, habitId, date)
- Belongs to Habit
- Unique constraint on (habitId, date) - one checkin per habit per day
- Cascade deletes when Habit is deleted

## Authentication & Authorization

- **JWT tokens** for authentication (configured in `src/config/env.ts`)
- Passwords hashed with bcrypt (10 rounds)
- Auth middleware (`src/middlewares/auth.middleware.ts`) extracts token from `Authorization: Bearer <token>` header
- Authenticated user data available as `req.user` (contains userId, email)
- Protected routes require auth middleware

## Environment Variables

Required variables (see `.env.example`):
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Must be at least 32 characters (validated by Zod in `src/config/env.ts`)
- `JWT_EXPIRES_IN` - Default "7d"
- `NODE_ENV` - "development" | "production" | "test"
- `PORT` - Default 3333
- `CORS_ORIGIN` - Default "*"
- `LOG_LEVEL` - "debug" | "info" | "warn" | "error"

All environment variables are validated at startup using Zod schema in `src/config/env.ts`.

## Path Aliases

TypeScript and Jest both support these path aliases (configured in `tsconfig.json` and `jest.config.js`):

```typescript
@/*            → src/*
@config/*      → src/config/*
@controllers/* → src/controllers/*
@services/*    → src/services/*
@repositories/* → src/repositories/*
@middlewares/* → src/middlewares/*
@routes/*      → src/routes/*
@schemas/*     → src/schemas/*
@types/*       → src/types/*
@utils/*       → src/utils/*
```

## API Structure

- Base path: `/api/v1`
- Routes defined in `src/routes/`:
  - `/api/v1/auth/*` - Authentication (register, login, me)
  - `/api/v1/habits/*` - Habits CRUD
  - `/api/v1/habits/:habitId/checkin` - Create checkin
  - `/api/v1/habits/:habitId/checkins` - List checkins
  - `/api/v1/habits/:habitId/stats` - Habit statistics

- Swagger docs available at `/api-docs` when server is running

## Validation

- All request validation uses **Zod** schemas in `src/schemas/`
- Validation middleware (`src/middlewares/validation.middleware.ts`) applies schemas to request bodies
- Validation errors return 422 status with descriptive messages

## Testing Strategy

- Tests in `tests/` directory mirror `src/` structure
- Setup file: `tests/setup.ts` (runs before all tests)
- Uses Jest with ts-jest preset
- Coverage excludes: type definitions, server entry point, types directory
- Run single test file: `npm test -- <filename>`
- Run tests matching pattern: `npm test -- -t "<pattern>"`

## Important Notes

- Server runs on port 3333 by default
- All async errors are handled via `express-async-errors` (no need for try/catch in controllers)
- API uses JSON for all request/response bodies
- TypeScript strict mode enabled with additional checks (noUnusedLocals, noUnusedParameters, noImplicitReturns)
- Security headers applied via Helmet middleware
- CORS configured via environment variable
