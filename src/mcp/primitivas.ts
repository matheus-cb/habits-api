import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// `zod/v4` pelo mesmo motivo de `tools.ts`: o SDK do MCP é tipado contra a v4, e
// esquema da v3 clássica estoura o heap do tsc com TS2589.
import { z } from 'zod/v4';
import { contratosDeEscrita } from './contratos';
import { GatewayDeQuery } from './query';
import { ALCANCE_TEM_IRREVERSIVEL, GatewayDeRequest, ROTAS_PERMITIDAS } from './request';

/**
 * As duas primitivas — o conceito central deste MCP, e onde ele se afasta do
 * NotaFlow de propósito.
 *
 * O NotaFlow expõe uma tool por operação: o alcance do assistente é exatamente o
 * que alguém antecipou. Aqui o Matheus pediu o contrário — e é decisão dele, não
 * economia minha: em vez de tool por pergunta, **dois métodos que o cliente
 * compõe**, com guardiões estruturais em volta.
 *
 * - `query`: SQL somente leitura. A pergunta é escrita por quem pergunta.
 * - `request`: chamada à própria API. Rota nova entra no alcance sem código novo,
 *   desde que alguém a classifique na allowlist.
 *
 * ## Onde a garantia mora, primitiva por primitiva
 *
 * O que muda em relação às tools nomeadas é **quem** garante, não se garante:
 *
 * | | tool nomeada | primitiva |
 * |---|---|---|
 * | não escreve | o gateway não tem método de escrita (tipo) | o role não tem grant (Postgres) |
 * | não vê dado alheio | o `userId` fecha por closure | RLS compara com `app.usuario_atual` |
 * | validação de entrada | Zod na tool | Zod na rota, igual ao navegador |
 * | irreversibilidade | não existe escrita | soft delete + extensão que recusa `delete` |
 *
 * A coluna da direita é **mais forte** em duas linhas e mais fraca em uma. Mais
 * forte porque permissão de banco e política de linha não dependem de eu ter
 * lembrado; mais fraca porque a allowlist do `request` é lista conferida em
 * runtime, não ausência de método. É por isso que ela é literal e fechada — ver o
 * cabeçalho de `request.ts`.
 *
 * ## Por que `escreve` não vira duas tools
 *
 * Separar em `request_read` e `request_write` deixaria o cliente anotar uma como
 * `readOnlyHint` e pedir confirmação só na outra. Não fiz, e o motivo é que a
 * separação seria por **anotação**, enquanto a lista já carrega `escreve` por
 * rota: duas tools seriam duas fontes de verdade para a mesma classificação, e a
 * que o cliente lê não é a que o gateway confere. Uma tool, `destructiveHint`
 * pessimista, e a distinção fina vem da lista.
 */

/** Nomes das primitivas. O teste de INV-25 confere que são só estas duas. */
export const PRIMITIVAS = ['query', 'request'] as const;

export function registrarPrimitivas(
  server: McpServer,
  {
    gatewayDeQuery,
    gatewayDeRequest,
    userId,
    token,
  }: {
    gatewayDeQuery: GatewayDeQuery | null;
    gatewayDeRequest: GatewayDeRequest;
    userId: string;
    token: string;
  }
): void {
  if (gatewayDeQuery) {
    server.registerTool(
      'query',
      {
        title: 'Consultar (SQL somente leitura)',
        description:
          'Executa SELECT sobre os SEUS dados. A conexão usa um role sem permissão de escrita e ' +
          'as tabelas têm Row-Level Security por usuário: INSERT/UPDATE/DELETE falham por ' +
          'permissão do Postgres, e nenhuma consulta alcança linha de outra pessoa — nem por ' +
          'JOIN. Um comando por chamada, até 8.000 caracteres, 500 linhas. Leia o recurso ' +
          '`habits://schema` para os nomes reais de tabela e coluna; eles são citados com aspas ' +
          'duplas quando têm maiúscula ("userId", "habitId", "deletedAt", "createdAt"). ' +
          'Registro apagado tem "deletedAt" não nulo — filtre por `"deletedAt" IS NULL` para ver ' +
          'só o que está ativo.',
        inputSchema: { sql: z.string().min(1).max(8000) },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ sql }) => json(await gatewayDeQuery.executar(userId, sql))
    );
  }

  server.registerTool(
    'request',
    {
      title: 'Chamar a API',
      description:
        'Faz uma chamada à API do Habits em seu nome. Só o path — o host é fixo. As rotas ' +
        'permitidas estão no recurso `habits://rotas`, com o corpo esperado em ' +
        '`habits://openapi`; qualquer outra é recusada com 403 antes de sair daqui. ' +
        'Apagar é reversível: DELETE de hábito e de check-in é LÓGICO e volta por `/restore`, e ' +
        'o apagamento físico não é rota. EDITAR não é: `PUT /habits/:id` e o confirm do ' +
        'reagendamento sobrescrevem sem histórico. Confirme com a pessoa antes de qualquer ' +
        'chamada que altere estado, e cite a rota e o corpo que você vai mandar.',
      inputSchema: {
        metodo: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
        path: z.string().min(1).describe('Começa com "/api/v1". Sem host.'),
        corpo: z.unknown().optional().describe('JSON do corpo, quando a rota pedir.'),
      },
      annotations: {
        readOnlyHint: false,
        // DERIVADO da allowlist, não escrito à mão. Ver `ALCANCE_TEM_IRREVERSIVEL`
        // em `request.ts` para o raciocínio e para o que o tornaria `false`.
        destructiveHint: ALCANCE_TEM_IRREVERSIVEL,
        idempotentHint: false,
        // Fechado: o `baseUrl` é o loopback deste processo, não a internet.
        openWorldHint: false,
      },
    },
    async ({ metodo, path, corpo }) => {
      const resposta = await gatewayDeRequest.chamar({ token, metodo, path, corpo });
      // O status vai junto do corpo porque a API responde com significado no
      // status: 409 é duplicata (não erro), 404 é hábito apagado, 400 é validação
      // recusada. Devolver só o corpo faria o cliente adivinhar o que aconteceu.
      return json({ status: resposta.status, corpo: resposta.corpo });
    }
  );
}

/**
 * Recursos de descoberta — o que torna as primitivas usáveis sem eu escrever
 * documentação que envelhece.
 *
 * `habits://schema` é **derivado do `information_schema`** pela própria conexão
 * somente-leitura. Coluna nova aparece sozinha; coluna removida desaparece. Uma
 * lista escrita à mão aqui seria a terceira cópia do schema no repositório, e a
 * única sem nada comparando com as outras duas.
 */
export function registrarRecursos(
  server: McpServer,
  {
    gatewayDeQuery,
    userId,
    openapi,
  }: { gatewayDeQuery: GatewayDeQuery | null; userId: string; openapi: unknown }
): void {
  if (gatewayDeQuery) {
    server.registerResource(
      'schema',
      'habits://schema',
      {
        title: 'Tabelas e colunas',
        description:
          'Nome e tipo de cada coluna visível à conexão somente-leitura, lido do catálogo do ' +
          'Postgres. É o que a primitiva `query` pode referenciar.',
        mimeType: 'application/json',
      },
      async () => {
        const resultado = await gatewayDeQuery.executar(
          userId,
          `SELECT table_name, column_name, data_type, is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name NOT LIKE '\\_prisma%'
            ORDER BY table_name, ordinal_position`
        );

        return {
          contents: [
            {
              uri: 'habits://schema',
              mimeType: 'application/json',
              text: JSON.stringify(resultado.linhas, null, 2),
            },
          ],
        };
      }
    );
  }

  server.registerResource(
    'rotas',
    'habits://rotas',
    {
      title: 'Rotas no alcance do assistente',
      description:
        'A allowlist da primitiva `request`, com método, padrão, motivo e se a chamada altera ' +
        'estado. Rota fora desta lista é recusada com 403.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'habits://rotas',
          mimeType: 'application/json',
          // A MESMA constante que o gateway confere. Se este recurso tivesse
          // cópia própria, ele descreveria um alcance que não é o real — e o
          // cliente confiaria na descrição.
          text: JSON.stringify(ROTAS_PERMITIDAS, null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'contratos',
    'habits://contratos',
    {
      title: 'Corpo exigido por cada rota de escrita',
      description:
        'JSON Schema de cada rota que altera estado, gerado a partir dos schemas Zod que o ' +
        'servidor realmente executa na validação. Se o corpo não casar, a resposta é 400 com o ' +
        'campo e o motivo — leia o erro e corrija, não tente de novo igual.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'habits://contratos',
          mimeType: 'application/json',
          text: JSON.stringify(contratosDeEscrita(), null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'openapi',
    'habits://openapi',
    {
      title: 'Metadados da API (OpenAPI)',
      description:
        'Servidores, autenticação e envelope de resposta. O `paths` deste documento está vazio — ' +
        'é dívida declarada do repositório, e o contrato de corpo que vale é `habits://contratos`.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'habits://openapi',
          mimeType: 'application/json',
          text: JSON.stringify(openapi, null, 2),
        },
      ],
    })
  );
}

function json(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}
