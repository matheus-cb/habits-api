import { Request, Response, NextFunction } from 'express';
// Os schemas migraram para `zod/v4` (ver o cabeçalho de `schemas/auth.schema.ts`).
import { ZodType } from 'zod/v4';

export function validateBody(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateParams(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // O cast existe porque o Express tipa `params` e `query` com formas
      // próprias (`ParamsDictionary`, `ParsedQs`) e o Zod devolve o tipo do
      // schema. O valor VALIDADO é o que segue — o cast troca o rótulo, não o
      // conteúdo.
      req.params = (await schema.parseAsync(req.params)) as typeof req.params;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateQuery(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.query = (await schema.parseAsync(req.query)) as typeof req.query;
      next();
    } catch (error) {
      next(error);
    }
  };
}
