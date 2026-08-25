/**
 * O perímetro do sistema, em forma de tabela.
 *
 * ## Por que este arquivo existe
 *
 * A pior falha desta safra foi um `spawn` que rodava com o `HOME` do usuário do
 * sistema operacional e tinha o conjunto nativo inteiro de tools disponível —
 * `Read`, `Write`, `Bash`. Uma mensagem de chat podia ler `~/.ssh` e devolver o
 * conteúdo pela resposta.
 *
 * As invariantes 25 a 38 governavam o que o **servidor** aceita, e governavam bem.
 * Nenhuma governava o subprocesso, porque a fronteira do sistema deixou de
 * coincidir com a API no commit em que ele entrou, e o mapa não acompanhou.
 *
 * ## Por que não é uma regra de julgamento
 *
 * "Pergunte onde está a fronteira" pede julgamento no instante, e é a categoria
 * que esta safra mostrou que falha. Mas a fronteira **não se move por vontade** —
 * ela se move quando entra um novo principal de execução, e isso tem assinatura
 * sintática. Grepável.
 *
 * Então é o mesmo procedimento de INV-26 (rotas), INV-29 (tabelas) e INV-32
 * (tabelas em cascade), pela quarta vez: **toda ocorrência que cria executor está
 * classificada, ou reprova.** O gate acusa depois do ato; a classificação é
 * preenchimento, não intuição.
 *
 * ## O campo que faz o trabalho é `credencial`
 *
 * Não é `superficie` nem `governadaPor` — é `credencial`. Escrever "o `HOME` de
 * quem instalou o CLI" ao lado de "apenas tools MCP" não sobrevive à leitura sem
 * alguém notar a distância entre as duas colunas.
 *
 * E o meu erro não foi falta de cuidado: quando criei a role somente-leitura eu
 * estava pensando **em segurança**, e respondi com grant explícito, RLS, política e
 * duas invariantes. Quando criei o subprocesso eu estava pensando **em custo e
 * autenticação**. O perímetro mudou nas duas vezes; eu só o vi na vez em que o
 * assunto do dia já era perímetro.
 */
export interface Executor {
  /** Arquivo e construção, como o grep os encontra. */
  onde: string;
  /** Quem executa de fato: um processo do SO, o Postgres, o próprio Node. */
  quem: string;
  /** **O campo que importa.** De quem é o privilégio. */
  credencial: string;
  /** O que ele alcança. */
  superficie: string;
  /** Qual invariante o governa, ou por que nenhuma governa. */
  governadaPor: string;
}

export const EXECUTORES: readonly Executor[] = [
  {
    onde: 'src/assistant/motor-cli.ts → spawn',
    quem: 'processo do sistema operacional',
    credencial: 'HOME e keychain de quem instalou o CLI — a assinatura pessoal',
    superficie: 'apenas as tools do --mcp-config; o conjunto nativo é VAZIO',
    governadaPor:
      'INV-39. Sem `--tools ""` ele tinha Read/Write/Bash e podia ler ~/.ssh — ' +
      'verificado com arquivo inofensivo. O ambiente exclui DATABASE_URL e JWT_SECRET.',
  },
  {
    onde: 'src/config/database.ts → new PrismaClient',
    quem: 'Postgres',
    credencial: 'dono das tabelas — **contorna RLS**',
    superficie: 'tudo, incluindo escrita',
    governadaPor:
      'Nenhuma política do banco, e é deliberado: o dono contorna RLS para a ' +
      'aplicação funcionar como antes. Quem o governa é a extensão de soft delete ' +
      '(lança em delete físico) e INV-02, que o proíbe fora de repositories/config.',
  },
  {
    onde: 'src/mcp/query.ts → new PrismaClient',
    quem: 'Postgres',
    credencial: 'habits_readonly — sem grant de escrita, **sujeito** a RLS',
    superficie: 'SELECT nas tabelas classificadas como expostas',
    governadaPor:
      'INV-27 (não escreve por permissão, não vê alheio por RLS, falha fechada) e ' +
      'INV-29 (tabela nova nasce inacessível). connection_limit=2 contra DoS.',
  },
  {
    onde: 'scripts/criar-conta.ts → new PrismaClient',
    quem: 'Postgres, fora do HTTP',
    // A credencial NÃO menciona "delete", nem para negar: o caso
    // `os dois executores com DELETE FÍSICO` filtra por /DELETE FÍSICO/i, e uma
    // negação escrita aqui seria lida como afirmação e classificaria este script
    // junto de `purge` e `reter-telemetria`.
    credencial: 'dono das tabelas, restrito a criar usuário',
    superficie: 'INSERT em users, e só isso',
    governadaPor:
      'INV-42, do outro lado: com o registro fechado, é este o caminho de criação. ' +
      'Não é rota de propósito — proteção topológica, não há endpoint a permitir ou ' +
      'negar. A senha é gerada aqui e nunca vem por argv, que vaza no histórico do ' +
      'shell e na lista de processos.',
  },
  {
    onde: 'scripts/purge.ts → new PrismaClient',
    quem: 'Postgres, fora do HTTP',
    credencial: 'dono das tabelas, com DELETE FÍSICO',
    superficie: 'apagar hábito e tudo em cascade',
    governadaPor:
      'INV-32 (exporta e CONTA tudo que o cascade destrói, antes de apagar). Não é ' +
      'rota de propósito: proteção topológica, não há endpoint a permitir ou negar.',
  },
  {
    onde: 'scripts/reter-telemetria.ts → new PrismaClient',
    quem: 'Postgres, fora do HTTP',
    credencial: 'dono das tabelas, com DELETE FÍSICO em ai_calls',
    superficie: 'agregar e descartar telemetria antiga',
    governadaPor:
      'INV-40. Agrega, CONFERE que o agregado bate, e só então apaga — em ' +
      'transação, então divergência desfaz tudo. Mesma ordem do purge.',
  },
];

/**
 * As construções que criam executor ou canal, e que o gate procura.
 *
 * Lista fechada e curta de propósito. Ela é a **fonte** do gate, e não o
 * contrário: construção nova entra aqui e o gate passa a exigir classificação para
 * ela — que é a direção segura, ao contrário de derivar a lista do que já existe.
 */
export const CONSTRUCOES_QUE_CRIAM_EXECUTOR = [
  'spawn(',
  'execFile(',
  'fork(',
  'new PrismaClient',
  'new Function',
  'new vm.',
] as const;
