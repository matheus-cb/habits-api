import { Request, Response, NextFunction } from 'express';
import { ZodError as ZodErrorV3 } from 'zod';
// As DUAS. Os schemas de contrato são da v4, e `config/env.ts` é da v3 — e a
// `ZodError` de uma NÃO é `instanceof` da outra. Conferir só uma transformaria
// erro de validação em 500 silenciosamente, que é a pior falha possível aqui:
// o cliente veria "erro interno" onde a resposta correta é 400 com o campo.
import { ZodError as ZodErrorV4 } from 'zod/v4';
import { AppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { errorResponse } from '@/utils/response';
import { env } from '@/config/env';

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): Response {
  // Zod validation errors
  if (error instanceof ZodErrorV4 || error instanceof ZodErrorV3) {
    // `.issues` e não `.errors`: na v4 `.errors` deixou de existir, e as duas
    // versões expõem `.issues`. É o único campo comum às duas — usar o da v3
    // daria `undefined.map` em toda validação de contrato.
    const errors = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return res.status(400).json(errorResponse('Validation failed', JSON.stringify(errors)));
  }

  // Operational errors (expected)
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(errorResponse(error.message));
  }

  // Unknown errors (unexpected)
  logger.error('Unexpected error:', error);

  const message = env.NODE_ENV === 'production' ? 'Internal server error' : error.message;

  return res.status(500).json(errorResponse(message));
}
