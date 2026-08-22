import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { createHabitSchema, updateHabitSchema } from '@/schemas/habits.schema';
import { authenticate } from '@/middlewares/auth.middleware';
import { errorHandler } from '@/middlewares/error.middleware';
import { AppError, ConflictError, ForbiddenError } from '@/utils/errors';
import { authConfig } from '@/config/auth';
import { AuthService } from '@/services/auth.service';

const SRC = path.join(__dirname, '..', '..', 'src');

function arquivosTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return arquivosTs(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * A invariante proíbe importar o CLIENTE do Prisma fora dos repositórios —
 * `@prisma/client` ou o binding `prisma`. Importar `connectDatabase` do mesmo
 * módulo é permitido: abrir e fechar conexão não é acesso a dado.
 */
function importaPrisma(conteudo: string): boolean {
  if (/from\s+'@prisma\/client'/.test(conteudo)) return true;
  const imports = conteudo.matchAll(
    /import\s+\{([^}]*)\}\s+from\s+'(?:@\/config\/database|\.{1,2}\/(?:[\w.-]+\/)*config\/database)'/g
  );
  for (const match of imports) {
    const nomes = (match[1] ?? '').split(',').map((nome) => nome.trim().split(/\s+as\s+/)[0]);
    if (nomes.includes('prisma')) return true;
  }
  return false;
}

describe('INV-02 — repositório é a única porta do banco', () => {
  it('INV-02: nenhum arquivo fora de src/repositories e src/config importa o Prisma', () => {
    // Esta é a invariante que se viola sem quebrar nada: um `import { prisma }`
    // dentro de um service funciona perfeitamente e destrói a camada. Só um
    // teste estático a pega.
    const permitidos = [path.join(SRC, 'repositories'), path.join(SRC, 'config')];

    const infratores = arquivosTs(SRC)
      .filter((arquivo) => !permitidos.some((dir) => arquivo.startsWith(dir)))
      .filter((arquivo) => importaPrisma(fs.readFileSync(arquivo, 'utf8')))
      .map((arquivo) => path.relative(SRC, arquivo));

    expect(infratores).toEqual([]);
  });

  it('INV-02: adversário — o próprio detector pega os imports que a invariante proíbe', () => {
    // Sem este caso, o teste acima passaria também com uma regex quebrada, e a
    // invariante ficaria "verificada" por um detector que não detecta nada.
    expect(importaPrisma("import { prisma } from '@/config/database';")).toBe(true);
    expect(importaPrisma("import { prisma } from '../config/database';")).toBe(true);
    expect(importaPrisma("import { PrismaClient } from '@prisma/client';")).toBe(true);
    expect(importaPrisma("import { Habit, prisma } from '@/config/database';")).toBe(true);

    // E que ele NÃO acusa o que é permitido: abrir e fechar conexão não é acesso
    // a dado, e é por isso que essas duas funções existem em config/database.
    expect(
      importaPrisma("import { connectDatabase, disconnectDatabase } from './config/database';")
    ).toBe(false);
  });
});

describe('INV-07 — scheduledDays é subconjunto de 0..6 sem repetição', () => {
  it('INV-07: conjunto válido é aceito', () => {
    expect(createHabitSchema.parse({ title: 'Correr', scheduledDays: [1, 3, 5] })).toMatchObject({
      scheduledDays: [1, 3, 5],
    });
  });

  it('INV-07: ausente é aceito e significa todo dia', () => {
    expect(createHabitSchema.parse({ title: 'Correr' }).scheduledDays).toBeUndefined();
  });

  it('INV-07: adversário — dia fora da faixa é recusado', () => {
    expect(() => createHabitSchema.parse({ title: 'Correr', scheduledDays: [7] })).toThrow(z.ZodError);
    expect(() => createHabitSchema.parse({ title: 'Correr', scheduledDays: [-1] })).toThrow(
      z.ZodError
    );
  });

  it('INV-07: adversário — dia repetido é recusado', () => {
    // `[1,1,1,1]` passava na versão anterior: validar faixa por elemento não diz
    // nada sobre o conjunto. Um conjunto sujo infla o denominador da aderência.
    expect(() => createHabitSchema.parse({ title: 'Correr', scheduledDays: [1, 1] })).toThrow(
      z.ZodError
    );
    expect(() =>
      updateHabitSchema.parse({ scheduledDays: [0, 1, 2, 3, 4, 5, 6, 6] })
    ).toThrow(z.ZodError);
  });

  it('INV-07: adversário — mais de sete entradas é recusado', () => {
    expect(() =>
      createHabitSchema.parse({ title: 'Correr', scheduledDays: [0, 1, 2, 3, 4, 5, 6, 0] })
    ).toThrow(z.ZodError);
  });

  it('INV-07: adversário — número fracionário é recusado', () => {
    expect(() => createHabitSchema.parse({ title: 'Correr', scheduledDays: [1.5] })).toThrow(
      z.ZodError
    );
  });
});

describe('INV-09 — Zod valida o ambiente na inicialização', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  it('INV-09: adversário — JWT_SECRET curto impede a inicialização', async () => {
    // O módulo lança no import. Se ele apenas avisasse, a API subiria com
    // segredo fraco e ninguém veria — "sobe configurado ou não sobe".
    jest.resetModules();
    process.env.JWT_SECRET = 'curto';

    await expect(async () => {
      await import('@/config/env');
    }).rejects.toThrow('Invalid environment variables');
  });

  it('INV-09: adversário — DATABASE_URL que não é URL impede a inicialização', async () => {
    jest.resetModules();
    process.env.DATABASE_URL = 'nao-e-url';

    await expect(async () => {
      await import('@/config/env');
    }).rejects.toThrow('Invalid environment variables');
  });

  it('INV-15: ANTHROPIC_API_KEY ausente NÃO impede a inicialização', async () => {
    // O outro lado da mesma moeda: a IA é opcional por construção. Se a chave
    // fosse obrigatória, a fronteira "funciona sem IA" seria falsa na largada.
    jest.resetModules();
    delete process.env.ANTHROPIC_API_KEY;

    const { env, aiConfigured } = await import('@/config/env');
    expect(env.DATABASE_URL).toBeDefined();
    expect(aiConfigured()).toBe(false);
  });

  it('INV-15: chave só de espaços conta como não configurada', async () => {
    jest.resetModules();
    process.env.ANTHROPIC_API_KEY = '   ';

    const { aiConfigured } = await import('@/config/env');
    expect(aiConfigured()).toBe(false);
  });
});

describe('INV-10 — identidade vem só do JWT verificado', () => {
  function contexto(headers: Record<string, string> = {}, body: unknown = {}) {
    const req = { headers, body, query: {} } as unknown as Request;
    const next = jest.fn();
    return { req, next };
  }

  it('INV-10: token válido popula req.user com o que está assinado', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.c' }, authConfig.secret);
    const { req, next } = contexto({ authorization: `Bearer ${token}` });

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('INV-10: adversário — userId no corpo da requisição é ignorado', () => {
    // Sem header nenhum, mas com userId no body. Se o middleware olhasse o body,
    // qualquer pessoa se autenticaria como qualquer outra.
    const { req, next } = contexto({}, { userId: 'vitima', user: { id: 'vitima' } });

    authenticate(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('INV-10: adversário — token assinado com outro segredo é recusado', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.c' }, 'outro-segredo-com-mais-de-32-chars!!');
    const { req, next } = contexto({ authorization: `Bearer ${token}` });

    authenticate(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('INV-10: adversário — token com alg none é recusado', () => {
    // O ataque clássico: assinatura vazia e `alg: none` no cabeçalho.
    const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const corpo = Buffer.from(JSON.stringify({ userId: 'vitima', email: 'v@b.c' })).toString(
      'base64url'
    );
    const { req, next } = contexto({ authorization: `Bearer ${cabecalho}.${corpo}.` });

    authenticate(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('INV-10: adversário — esquema diferente de Bearer é recusado', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.c' }, authConfig.secret);
    const { req, next } = contexto({ authorization: `Basic ${token}` });

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('INV-10: adversário — token expirado é recusado', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.c' }, authConfig.secret, {
      expiresIn: '-1s',
    });
    const { req, next } = contexto({ authorization: `Bearer ${token}` });

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('INV-11 — senha nunca sai do service', () => {
  const usersRepository = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const authService = new AuthService(usersRepository as never);

  const gravado = {
    id: 'u1',
    name: 'Matheus',
    email: 'a@b.c',
    password: '$2a$10$hash-que-nao-pode-vazar',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('INV-11: o registro devolve usuário sem o campo password', async () => {
    usersRepository.findByEmail.mockResolvedValueOnce(null);
    usersRepository.create.mockResolvedValueOnce(gravado);

    const resultado = await authService.register({
      name: 'Matheus',
      email: 'a@b.c',
      password: 'senha-forte-123',
    });

    expect(resultado.user).not.toHaveProperty('password');
    expect(JSON.stringify(resultado)).not.toContain(gravado.password);
  });

  it('INV-11: adversário — nem o hash aparece em nenhum ponto da resposta de login', async () => {
    // Serializar o objeto todo e procurar o hash pega vazamento aninhado, que a
    // checagem `not.toHaveProperty('password')` no nível de cima não pegaria.
    usersRepository.findByEmail.mockResolvedValueOnce({
      ...gravado,
      password: await import('bcryptjs').then((b) => b.hash('senha-forte-123', 4)),
    });

    const resultado = await authService.login({ email: 'a@b.c', password: 'senha-forte-123' });

    expect(JSON.stringify(resultado)).not.toContain('$2');
    expect(resultado.user).not.toHaveProperty('password');
  });

  it('INV-11: adversário — getProfile também não devolve password', async () => {
    usersRepository.findById.mockResolvedValueOnce(gravado);

    const perfil = await authService.getProfile('u1');

    expect(perfil).not.toHaveProperty('password');
    expect(JSON.stringify(perfil)).not.toContain(gravado.password);
  });
});

describe('INV-12 — erro esperado tem status; desconhecido não vaza mensagem em produção', () => {
  function resposta() {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    return { res: { status } as unknown as Response, status, json };
  }

  it('INV-12: AppError responde com o próprio statusCode e a própria mensagem', () => {
    const { res, status, json } = resposta();

    errorHandler(new ConflictError('já existe'), {} as Request, res, jest.fn());

    expect(status).toHaveBeenCalledWith(409);
    // `errorResponse(error, message)` põe o texto principal no campo `error`; o
    // `message` guarda o detalhe. Nomes trocados em relação ao esperado, e é o
    // contrato que os dois clientes já consomem — o teste documenta o que é.
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'já existe' }));
  });

  it('INV-12: ForbiddenError responde 403', () => {
    const { res, status } = resposta();
    errorHandler(new ForbiddenError(), {} as Request, res, jest.fn());
    expect(status).toHaveBeenCalledWith(403);
  });

  it('INV-12: adversário — erro desconhecido não vaza a mensagem em produção', async () => {
    // O middleware registra o erro no log de propósito — é ali que o detalhe deve
    // ficar. Silenciar o console aqui evita que a saída da suíte pareça falha.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    // O detalhe de um erro inesperado costuma trazer nome de tabela, caminho de
    // arquivo ou trecho de query. Em produção ele fica no log, não na resposta.
    jest.resetModules();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { errorHandler: handler } = await import('@/middlewares/error.middleware');
      const { res, status, json } = resposta();

      handler(
        new Error('relation "users" does not exist at /app/src/repo.ts:12'),
        {} as Request,
        res,
        jest.fn()
      );

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' })
      );
      expect(JSON.stringify(json.mock.calls)).not.toContain('users');
      expect(JSON.stringify(json.mock.calls)).not.toContain('/app/src');
    } finally {
      consoleError.mockRestore();
      process.env.NODE_ENV = original;
      jest.resetModules();
    }
  });

  it('INV-12: erro de validação Zod responde 400 com os campos', () => {
    const { res, status, json } = resposta();
    const zodError = (() => {
      try {
        z.object({ title: z.string() }).parse({});
        throw new Error('inalcançável');
      } catch (error) {
        return error as z.ZodError;
      }
    })();

    errorHandler(zodError, {} as Request, res, jest.fn());

    // Documenta o comportamento real: 400, não 422. A doc anterior dizia 422 e o
    // código dizia 400 — a divergência ficou dois anos sem teste.
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('INV-12: AppError não operacional continua respondendo o próprio status', () => {
    const { res, status } = resposta();
    errorHandler(new AppError('falha interna controlada', 503, false), {} as Request, res, jest.fn());
    expect(status).toHaveBeenCalledWith(503);
  });
});
