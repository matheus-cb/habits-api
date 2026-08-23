import { Prisma } from '@prisma/client';

/**
 * Filtro de soft delete, aplicado em UM lugar.
 *
 * Há 13 chamadas de leitura a `habit` e `checkin` nos repositories. Adicionar
 * `where: { deletedAt: null }` em cada uma é convidar o defeito que esta semana
 * inteira produziu treze vezes: a verificação existe em doze lugares, falta no
 * décimo terceiro, e dado apagado reaparece sem nada acusar.
 *
 * A extensão intercepta toda operação de leitura dos dois modelos e injeta o
 * predicado. Quem escrever a décima quarta consulta não precisa lembrar.
 *
 * Duas coisas que ela deliberadamente NÃO faz:
 *
 * - Não intercepta `users`: apagar conta não está no alcance do assistente, e
 *   filtrar um modelo que não tem a coluna quebraria toda consulta de usuário.
 * - Não intercepta `create` nem `update`. `update` é como o soft delete e o
 *   restore são executados, então filtrá-lo tornaria impossível restaurar — o
 *   registro apagado ficaria invisível para o próprio comando que o traz de
 *   volta. Quem precisa alcançar apagado usa os métodos explícitos do
 *   repositório, que existem só para isso.
 * - Não intercepta `upsert`, e hoje ele é inalcançável nestes modelos: o input
 *   composto `habitId_date` deixou de existir junto com o `@@unique`. Fica
 *   registrado porque `upsert` é leitura mais escrita e a leitura dele NÃO seria
 *   filtrada — se o índice único voltar ao schema, o furo aparece pronto.
 *
 * ## O que ela IMPEDE, e por que isso é o coração da promessa
 *
 * `delete` e `deleteMany` **lançam**. A afirmação "o delete alcançável é lógico e
 * reversível" era sustentada por ninguém chamar `prisma.habit.delete` — ausência
 * de chamador, não impossibilidade. Com uma primitiva de requisição genérica
 * chegando, o que separaria um delete físico de um lógico passaria a ser uma
 * allowlist: verificação, não estrutura.
 *
 * Lançar move a garantia para o mesmo lugar onde estão as outras: quem tentar
 * apagar fisicamente por este client falha, e o único caminho físico é
 * `scripts/purge.ts`, que usa client próprio de propósito.
 */
/**
 * As duas políticas de escrita desta aplicação, e o que as une.
 *
 * **Nenhuma das duas admite delete físico pela aplicação — por razões opostas:**
 * a reversível porque o dado volta, a imutável porque o dado nunca muda. Nomear
 * pela política e não pela mecânica é o que faz essa frase se ler sem comentário;
 * o nome anterior (`MODELOS_COM_SOFT_DELETE`) descrevia o COMO, e a segunda lista
 * descrevia o como do lado oposto — obrigando quem lesse a reconstituir por que
 * uma tabela está numa e não na outra.
 */
const MODELOS_REVERSIVEIS = new Set(['Habit', 'Checkin']);

/**
 * Append-only: a linha nasce e não muda mais.
 *
 * `HabitRevision` não é reversível porque não há o que reverter — uma revisão
 * apagada logicamente seria uma versão que existiu, deixou de aparecer e
 * continua no banco: três estados numa tabela cujo propósito é ter dois.
 *
 * Ela precisa da outra metade da proteção. Sem esta lista, `revision.delete`
 * passaria pelo primeiro `if` da extensão, que devolve `query(args)` para todo
 * modelo fora da lista de reversíveis. Histórico que a aplicação apaga não é
 * histórico, e o caminho até ele passaria pela primitiva `request` no dia em que
 * alguém expusesse uma rota de limpeza.
 *
 * O caminho físico continua sendo o `CASCADE` do purge, que usa client próprio —
 * e o purge exporta as revisões antes, o que INV-32 é o gate de garantir.
 */
const MODELOS_IMUTAVEIS = new Set(['HabitRevision']);

/** Alcançam linha apagada e a modificam. Filtradas, não proibidas. */
const OPERACOES_DE_ESCRITA_EM_LOTE = new Set(['updateMany']);

/** Delete físico. Proibidas neste client. */
const OPERACOES_DE_DELETE_FISICO = new Set(['delete', 'deleteMany']);

const OPERACOES_DE_LEITURA = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export const softDelete = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (MODELOS_IMUTAVEIS.has(model) && OPERACOES_DE_DELETE_FISICO.has(operation)) {
          throw new Error(
            `${model}.${operation} não é permitido: histórico que a aplicação apaga não é ` +
              'histórico. A remoção só acontece por CASCADE em `npm run purge`.'
          );
        }

        if (!MODELOS_REVERSIVEIS.has(model)) {
          return query(args);
        }

        if (OPERACOES_DE_DELETE_FISICO.has(operation)) {
          throw new Error(
            `${model}.${operation} é delete FÍSICO e não é permitido neste client. ` +
              'Soft delete é `update` com deletedAt; o físico só por scripts/purge.ts, ' +
              'que usa client próprio. Ver src/config/soft-delete.ts.'
          );
        }

        const filtravel =
          OPERACOES_DE_LEITURA.has(operation) || OPERACOES_DE_ESCRITA_EM_LOTE.has(operation);
        if (!filtravel) {
          return query(args);
        }

        const argumentos = args as { where?: Record<string, unknown> };

        // Quem declara `deletedAt` no `where` está dizendo explicitamente qual
        // estado quer, e a injeção não pode sobrescrever isso.
        //
        // Não é hipotético: `restore` faz
        // `updateMany({ where: { habitId, deletedAt: <timestamp do lote> } })`, e
        // com a injeção vencendo ele passaria a alterar as linhas ATIVAS — o
        // oposto do que o nome diz. Os testes de restore pegaram.
        if (
          argumentos.where &&
          ('deletedAt' in argumentos.where || 'deleteBatchId' in argumentos.where)
        ) {
          return query(args);
        }

        // `findUnique` não aceita campo não-único no `where`, então o predicado
        // não pode ser injetado nele. Em vez de converter silenciosamente para
        // `findFirst` — que funcionaria, e esconderia a diferença —, isto FALHA.
        //
        // O motivo é o mesmo que fez esta extensão existir: conversão silenciosa
        // é a categoria de defeito que passa treze vezes. Falhar alto obriga quem
        // escrever a próxima consulta a usar `findFirst`, que é filtrado, ou os
        // métodos explícitos do repositório quando quiser alcançar apagado.
        if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
          throw new Error(
            `${model}.${operation} não é permitido: não aceita o filtro de soft delete. ` +
              'Use findFirst/findFirstOrThrow, ou um método explícito do repositório ' +
              'quando precisar alcançar registro apagado. Ver src/config/soft-delete.ts.'
          );
        }

        return query({
          ...argumentos,
          where: { ...(argumentos.where ?? {}), deletedAt: null },
        });
      },
    },
  },
});
