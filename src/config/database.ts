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
