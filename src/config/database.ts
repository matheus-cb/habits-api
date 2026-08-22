import { PrismaClient } from '@prisma/client';
import { env } from './env';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') globalThis.prisma = prisma;

/**
 * Ciclo de vida da conexão.
 *
 * Existem aqui, e não no `server.ts`, para que o Prisma seja importado em um
 * único lugar fora dos repositórios (INV-02). Antes o `server.ts` importava
 * `prisma` só para chamar `$connect`/`$disconnect`, e isso abria uma exceção na
 * invariante por um motivo que não é acesso a dado.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Verifica se o banco responde E se o esquema está aplicado.
 *
 * `$queryRaw SELECT 1` provaria só a conexão, e o defeito real era outro: banco
 * conectável, esquema ausente. Consultar uma tabela do domínio prova as duas
 * coisas, e é a diferença entre "o processo está vivo" e "esta instância
 * consegue atender".
 *
 * O `reason` é curto de propósito: healthcheck é endpoint sem autenticação, e
 * mensagem de erro de banco carrega nome de tabela e caminho de arquivo.
 */
export async function checkDatabase(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await prisma.user.count();
    return { ok: true };
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    return { ok: false, reason: codigo === 'P2021' ? 'schema-missing' : 'unreachable' };
  }
}
