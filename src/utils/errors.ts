export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // `new.target.prototype`, e NÃO `AppError.prototype`.
    //
    // A versão anterior fixava o protótipo em `AppError`, o que apagava a
    // identidade de TODA subclasse: `new NotFoundError('x') instanceof
    // NotFoundError` devolvia `false`, e `erro.constructor.name` dizia
    // "AppError" em todo log. Nada quebrava, porque o middleware de erro confere
    // `instanceof AppError` — que é justamente o único caso que a linha errada
    // fazia funcionar.
    //
    // `new.target` é a classe que o `new` invocou de verdade, então a linha passa
    // a preservar o que ela deveria ter preservado desde o começo: a cadeia de
    // protótipo que o `extends` monta. O `setPrototypeOf` continua sendo
    // necessário porque `Error` é exótico — subclassear sem isto perde o
    // protótipo em alvos ES5.
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 422);
  }
}

/**
 * 429. Fica aqui, com as outras, e não junto do middleware que a lança: a
 * hierarquia de erro é uma coisa só, e o `errorHandler` a trata por `statusCode`.
 */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too Many Requests') {
    super(message, 429);
  }
}
