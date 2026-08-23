import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { BadRequestError } from '@/utils/errors';

/**
 * Primitiva `query` — SQL somente leitura sobre os dados de quem chamou.
 *
 * Existe porque REST não expressa análise: comparar períodos, correlacionar dois
 * hábitos, achar padrão por dia da semana. Em vez de eu escrever uma tool por
 * pergunta, o cliente escreve a pergunta.
 *
 * ## As duas garantias, e por que nenhuma delas parseia SQL
 *
 * Validar a query por análise sintática perde: comentário, CTE, subconsulta,
 * `DO`, função. É a mesma lição do guarda numérico da camada de IA — verificação
 * sobre texto só pega quem inventa, não quem recombina. Então:
 *
 * 1. **Não escreve** porque a conexão usa o role `habits_readonly`, que tem
 *    `pg_read_all_data` e **zero grant de escrita**. Um INSERT falha por
 *    permissão do Postgres, não porque eu adivinhei a gramática.
 * 2. **Não vê dado alheio** porque as três tabelas têm Row-Level Security, e a
 *    política compara com `app.usuario_atual`, definido por `SET LOCAL` dentro da
 *    transação desta consulta. Verificado: `SELECT * FROM users` devolve uma
 *    linha, a de quem chamou.
 *
 * A propriedade que mais importa: `current_setting(…, true)` devolve NULL quando
 * a variável não existe, e NULL não casa com nada. **Esquecer o `SET` produz zero
 * linhas, não vazamento** — falha fechada.
 *
 * Por isso tudo roda em transação explícita: `SET LOCAL` morre com ela. Fora de
 * transação o `SET LOCAL` não teria escopo, e o pool poderia entregar a conexão
 * com a variável de outro usuário — o único caminho por onde este desenho
 * vazaria, e é o que a transação fecha.
 */

/** Teto de linhas. O `statement_timeout` do role cobre tempo; isto cobre volume. */
const MAXIMO_DE_LINHAS = 500;

export interface ResultadoDeQuery {
  linhas: unknown[];
  total: number;
  truncado: boolean;
}

export interface GatewayDeQuery {
  executar(userId: string, sql: string): Promise<ResultadoDeQuery>;
}

/** `null` quando não há conexão somente-leitura configurada. */
export function criarGatewayDeQuery(): GatewayDeQuery | null {
  const url = env.DATABASE_URL_READONLY?.trim();
  if (!url) return null;
  return new PostgresQueryGateway(url);
}

class PostgresQueryGateway implements GatewayDeQuery {
  private readonly client: PrismaClient;

  constructor(url: string) {
    // Client PRÓPRIO, com a URL da role somente-leitura. Reusar o client da
    // aplicação daria a esta primitiva os privilégios de escrita do dono das
    // tabelas — e o dono também contorna RLS, então as duas garantias cairiam de
    // uma vez.
    this.client = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
  }

  async executar(userId: string, sql: string): Promise<ResultadoDeQuery> {
    const consulta = sql.trim();

    if (consulta.length === 0) {
      throw new BadRequestError('Consulta vazia.');
    }
    if (consulta.length > 8000) {
      throw new BadRequestError('Consulta acima de 8.000 caracteres.');
    }

    // Um comando por chamada. Isto NÃO é validação de conteúdo — é a única forma
    // de o `SET LOCAL` não poder ser desfeito por um `RESET` no mesmo lote. As
    // garantias de escrita e de escopo continuam sendo do banco.
    if (/;\s*\S/.test(consulta.replace(/;\s*$/, ''))) {
      throw new BadRequestError(
        'Envie um comando por vez. Vários comandos numa chamada não são aceitos.'
      );
    }

    try {
      return await this.client.$transaction(async (tx) => {
        // `SET LOCAL` com valor interpolado precisa de `set_config`, porque
        // `SET LOCAL` não aceita parâmetro. `set_config(…, true)` é o equivalente
        // com escopo de transação, e aqui o valor VAI parametrizado — o userId
        // vem do JWT, mas parametrizar é grátis e fecha a categoria.
        await tx.$executeRaw`SELECT set_config('app.usuario_atual', ${userId}, true)`;

        const linhas = await tx.$queryRawUnsafe<unknown[]>(consulta);
        const total = Array.isArray(linhas) ? linhas.length : 0;

        return {
          linhas: Array.isArray(linhas) ? linhas.slice(0, MAXIMO_DE_LINHAS) : [],
          total,
          truncado: total > MAXIMO_DE_LINHAS,
        };
      });
    } catch (erro) {
      // A mensagem do Postgres é devolvida de propósito: quem escreveu a query
      // precisa saber que a coluna não existe ou que a permissão foi negada, ou
      // não consegue corrigir. Ela não carrega dado de outro usuário — RLS
      // garante isso antes de qualquer linha ser lida.
      throw new BadRequestError(
        `A consulta falhou: ${erro instanceof Error ? mensagemDoBanco(erro.message) : 'erro desconhecido'}`
      );
    }
  }
}

/**
 * A mensagem do banco, não o cabeçalho do Prisma.
 *
 * O Prisma prefixa com "Invalid `prisma.$queryRawUnsafe()` invocation:" e põe o
 * erro real do Postgres nas últimas linhas. Pegar a PRIMEIRA linha devolvia só o
 * cabeçalho — inútil para quem escreveu a consulta, que precisa saber que foi
 * `permission denied` ou coluna inexistente para corrigir.
 */
function mensagemDoBanco(mensagem: string): string {
  const linhas = mensagem
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);

  return linhas[linhas.length - 1] ?? mensagem;
}
