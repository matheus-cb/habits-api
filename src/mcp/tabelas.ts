/**
 * As tabelas que a primitiva `query` alcança, e as que não alcança de propósito.
 *
 * Par de `ROTAS_PERMITIDAS`/`ROTAS_NEGADAS`, aplicado ao banco em vez de às
 * rotas — e existe pelo mesmo motivo. A migração original deu `pg_read_all_data`
 * à role somente-leitura, o que tornou a leitura **global e opt-out** enquanto o
 * escopo continuava por tabela e opt-in. Tabela nova nasceria legível por
 * inteiro, sem RLS, sem aviso, e sem nenhum teste falhando.
 *
 * A migração `20260823160000_grant_explicito` fechou o default. Estas listas são
 * o gate que impede a regressão: INV-29 enumera `pg_tables` e exige que cada
 * tabela esteja numa das duas. Tabela fora reprova, como rota órfã reprova.
 *
 * A lista de expostas é literal pela mesma razão da allowlist de rotas: derivar
 * do que existe faria tabela nova nascer permitida, e essa divergência não tem
 * volta. Divergir para "menos exposto do que existe" faz uma consulta legítima
 * falhar, alguém escrever o grant, e a política junto.
 */

/** Alcançáveis por `query`: com grant de SELECT **e** política de RLS por usuário. */
export const TABELAS_EXPOSTAS = [
  'users',
  'habits',
  'checkins',
  'habit_revisions',
  // As quatro do assistente conversacional. Expostas pelo mesmo motivo do
  // histórico de edição: "o que eu pedi ao assistente na semana passada?" e
  // "quanto isto está me custando?" são perguntas que se quer fazer em linguagem
  // natural, e o RLS as escopa pelo dono.
  //
  // `ai_calls` é a mais útil das quatro e a que menos parece: ela é o extrato de
  // consumo. Sem ela exposta, a pessoa depende da interface para saber o custo, e
  // não pode perguntar "em que dia eu gastei mais?".
  'conversations',
  'conversation_messages',
  'pending_actions',
  'ai_calls',
] as const;

/** Existem e não são alcançáveis. O motivo é o que impede a lista de virar despejo. */
export const TABELAS_NAO_EXPOSTAS: readonly { tabela: string; motivo: string }[] = [
  {
    tabela: '_prisma_migrations',
    motivo: 'histórico de migração: não é dado de ninguém e não tem dono por linha',
  },
];
