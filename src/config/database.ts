import { clearTimeout, setTimeout } from 'node:timers';
import { PrismaClient } from '@prisma/client';
import { softDelete } from './soft-delete';
import { env } from './env';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // A extensão de soft delete é aplicada AQUI, no singleton, e não em cada
    // repositório. Aplicar por repositório deixaria a décima quarta consulta sem
    // filtro, que é o defeito que a extensão existe para impedir.
  }).$extends(softDelete);
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

/** Teto de espera do healthcheck. Ver o comentário de `checkDatabase`. */
const HEALTHCHECK_TIMEOUT_MS = 2000;

/**
 * Verifica se o banco responde E se o esquema está aplicado.
 *
 * `SELECT 1` provaria só a conexão, e o defeito real era outro: banco
 * conectável, esquema ausente. Uma consulta a tabela do domínio prova as duas
 * coisas, e é a diferença entre "o processo está vivo" e "esta instância
 * consegue atender".
 *
 * `findFirst` com `select: { id: true }` e não `count()`: os dois provam
 * conexão, tabela e coluna, mas `count()` é `SELECT COUNT(*)` e paga um scan da
 * tabela inteira a cada chamada — num endpoint que orquestrador consulta a cada
 * poucos segundos, para sempre. `findFirst` é tempo constante e devolve o mesmo
 * `P2021` quando a tabela não existe.
 *
 * O timeout existe porque banco que aceita conexão e não responde penduraria o
 * `await`, retendo a conexão em vez de devolver 503. Healthcheck que não
 * responde rápido é healthcheck que falhou.
 *
 * O `reason` é curto de propósito: este endpoint não tem autenticação, e
 * mensagem de erro de banco carrega nome de tabela e caminho de arquivo.
 */
export async function checkDatabase(): Promise<{ ok: true } | { ok: false; reason: string }> {
  let expirar: ReturnType<typeof setTimeout> | undefined;

  try {
    const consulta = prisma.user.findFirst({ select: { id: true } });
    const limite = new Promise<never>((_, reject) => {
      expirar = setTimeout(() => reject(new Error('healthcheck-timeout')), HEALTHCHECK_TIMEOUT_MS);
    });

    await Promise.race([consulta, limite]);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'healthcheck-timeout') {
      return { ok: false, reason: 'timeout' };
    }
    const codigo = (error as { code?: string }).code;
    return { ok: false, reason: codigo === 'P2021' ? 'schema-missing' : 'unreachable' };
  } finally {
    // Sem isto o timer segura o event loop pelos 2s mesmo quando a consulta já
    // respondeu, e o processo demora a encerrar.
    if (expirar) clearTimeout(expirar);
  }
}
