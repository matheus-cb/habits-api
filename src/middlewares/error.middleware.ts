import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
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
  if (error instanceof ZodError) {
    const errors = error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
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
