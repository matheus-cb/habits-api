import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
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

/**
 * Teto de linhas, imposto pelo **banco** e não pelo Node.
 *
 * A primeira versão fazia `linhas.slice(0, 500)` depois da consulta, com o
 * comentário "o `statement_timeout` cobre tempo; isto cobre volume". Ele cobria o
 * volume DEVOLVIDO ao cliente MCP, não o volume MATERIALIZADO na heap do
 * processo — o mesmo processo que serve o HTTP. E o caminho não precisa de bug
 * nem de dado alheio: `SELECT * FROM checkins a, checkins b` são linhas próprias,
 * permitidas pela política, e mil check-ins produzem um milhão de linhas
 * legítimas.
 *
 * A consulta agora vai envelopada em `SELECT * FROM (…) AS sub LIMIT 501`. Isso é
 * **composição textual, não análise sintática**: nada aqui inspeciona o que a
 * consulta faz.
 *
 * ## O envelope virou uma segunda barreira, e mudou o modo de falha
 *
 * Consequência que eu não previ e que vale registrar em cheio, porque ela altera
 * o que os testes podem observar: dentro de uma subconsulta, o Postgres recusa
 * escrita **no parser dele**. `INSERT` cru dá erro de sintaxe, e CTE que escreve
 * dá `WITH clause containing a data-modifying statement must be at the top level`.
 * Então uma tentativa de escrita pela primitiva não chega mais a ser recusada por
 * permissão — ela é recusada antes, pela gramática.
 *
 * Isso **não** enfraquece o desenho, e a distinção é fina: o parser é o do
 * Postgres, não meu. Continuo sem adivinhar gramática. O que existem agora são
 * duas barreiras independentes, as duas do banco:
 *
 *   1. **gramática** — escrita não pode aparecer dentro de subconsulta;
 *   2. **permissão** — se pudesse, a role não tem grant.
 *
 * A segunda deixou de ser observável ATRAVÉS da primitiva, e é por isso que o
 * teste de INV-27 a exercita direto na conexão somente-leitura, sem o envelope.
 * Verificar só o caminho de cima diria "a escrita falha" e deixaria de provar
 * **por quê**.
 *
 * ## Se você for remover o envelope
 *
 * Ele é a mais frágil das três defesas desta primitiva, e a **única que é deste
 * arquivo** — as outras duas são grant e política, que vivem no banco. Removê-lo
 * por otimização parece seguro, porque o teste de escrita pela primitiva continua
 * passando: a permissão assume o lugar da gramática e a chamada segue falhando.
 * O que muda em silêncio é o teto de volume, que volta a ser `slice` na heap.
 *
 * Então: remover exige rodar `tests/integration/primitivas-mcp.test.ts` inteiro,
 * e ler os dois casos de INV-27 — não só ver a suíte verde.
 */
const MAXIMO_DE_LINHAS = 500;

export interface ResultadoDeQuery {
  linhas: unknown[];
  truncado: boolean;
}

export interface GatewayDeQuery {
  executar(userId: string, sql: string): Promise<ResultadoDeQuery>;
  encerrar(): Promise<void>;
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
    //
    // `connection_limit=2` é o teto de pool, e é o guardião ESTRUTURAL contra a
    // negação de serviço: N consultas simultâneas passam a esperar na fila deste
    // pool em vez de abrir N conexões e disputar o Postgres com a aplicação que
    // atende o dashboard e o mobile. O limite de taxa (`middlewares/rate-limit`)
    // cobre a frequência; isto cobre a simultaneidade, e nenhum dos dois depende
    // de quem chama lembrar de nada.
    this.client = new PrismaClient({
      datasources: { db: { url: comTetoDePool(url) } },
      log: ['error'],
    });
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

    const inicio = process.hrtime.bigint();

    try {
      const resultado = await this.client.$transaction(async (tx) => {
        // `SET LOCAL` com valor interpolado precisa de `set_config`, porque
        // `SET LOCAL` não aceita parâmetro. `set_config(…, true)` é o equivalente
        // com escopo de transação, e aqui o valor VAI parametrizado — o userId
        // vem do JWT, mas parametrizar é grátis e fecha a categoria.
        await tx.$executeRaw`SELECT set_config('app.usuario_atual', ${userId}, true)`;

        // `+ 1` para distinguir "exatamente no teto" de "passou do teto": se
        // voltarem 501 linhas, havia mais. Contar sem o extra faria 500 exatas
        // serem reportadas como truncadas.
        const lidas = await tx.$queryRawUnsafe<unknown[]>(
          `SELECT * FROM (${consulta}) AS sub LIMIT ${MAXIMO_DE_LINHAS + 1}`
        );
        const linhas = Array.isArray(lidas) ? lidas : [];

        return {
          linhas: linhas.slice(0, MAXIMO_DE_LINHAS),
          // Derivado de ter voltado o extra. O campo `total` da versão anterior
          // reportava "linhas lidas" e era lido como "linhas que existem" —
          // número honesto com significado errado, o que é pior que nenhum.
          truncado: linhas.length > MAXIMO_DE_LINHAS,
        };
      });

      // Uma primitiva de execução arbitrária tem de deixar rastro. Sem isto, o
      // primeiro incidente — uma consulta que pesa no banco, um erro que o
      // cliente relata sem reproduzir — é indepurável. Não é a auditoria de IA,
      // que é trabalho seguinte; é o mínimo que torna a ausência dela suportável.
      logger.info('mcp query', {
        userId,
        ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
        linhas: resultado.linhas.length,
        truncado: resultado.truncado,
        sql: consulta,
      });

      return resultado;
    } catch (erro) {
      logger.warn('mcp query falhou', {
        userId,
        ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
        sql: consulta,
        erro: erro instanceof Error ? mensagemDoBanco(erro.message) : 'desconhecido',
      });
      // A mensagem do Postgres é devolvida de propósito: quem escreveu a query
      // precisa saber que a coluna não existe ou que a permissão foi negada, ou
      // não consegue corrigir. Ela não carrega dado de outro usuário — RLS
      // garante isso antes de qualquer linha ser lida.
      throw new BadRequestError(
        `A consulta falhou: ${erro instanceof Error ? mensagemDoBanco(erro.message) : 'erro desconhecido'}`
      );
    }
  }

  /** Fecha o pool próprio. Em produção o processo morre; em teste, sem isto a
   * conexão fica pendurada e o Jest não encerra. */
  async encerrar(): Promise<void> {
    await this.client.$disconnect();
  }
}

/**
 * Acrescenta `connection_limit=2` sem sobrescrever o que já estiver na URL.
 *
 * Fixar o valor por concatenação cega duplicaria o parâmetro quando alguém já o
 * tivesse configurado em produção — e o Postgres aceitaria o último, tornando a
 * configuração de quem opera silenciosamente ignorada. `URL` normaliza.
 */
function comTetoDePool(url: string): string {
  const alvo = new URL(url);
  if (!alvo.searchParams.has('connection_limit')) {
    alvo.searchParams.set('connection_limit', '2');
  }
  return alvo.toString();
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
