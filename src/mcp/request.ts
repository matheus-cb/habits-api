import { BadRequestError, ForbiddenError } from '@/utils/errors';
import { enderecoLocal } from './endereco';
import { CABECALHO_DE_ORIGEM, CABECALHO_DE_PROVA, provaDeOrigem } from './origem';

/**
 * Primitiva `request` — qualquer chamada à própria API, composta pelo cliente.
 *
 * Existe para o assistente não depender de eu escrever uma tool por endpoint:
 * rota nova aparece sozinha. É a metade de escrita do conceito, e a que troca
 * garantia de tipo por garantia de allowlist.
 *
 * ## O que se perde, dito sem enfeite
 *
 * O `ReadOnlyHabitsGateway` das tools nomeadas não tem método de escrita: a
 * barreira é o tipo, e não há o que chamar. Aqui a barreira é uma lista conferida
 * em tempo de execução. Isso é **mais fraco**, e o que sustenta é a lista ser
 * fechada e testada, mais o fato de a API impor dono, duplicata e validação em
 * cada chamada — as invariantes INV-03, INV-05, INV-07 e INV-10 valem para o
 * assistente exatamente como valem para o navegador.
 *
 * ## Por que a lista NÃO é derivada do OpenAPI
 *
 * Duas vezes nesta semana eu aprendi que lista literal diverge e lista derivada
 * não. Aqui eu escolhi literal de propósito, e o motivo é a direção da
 * divergência: derivar do spec faria **rota nova nascer permitida**. Um endpoint
 * destrutivo acrescentado amanhã entraria no alcance do assistente por omissão,
 * sem ninguém decidir.
 *
 * Numa lista de política de segurança, o default seguro é negar. Divergir para
 * "menos permitido do que existe" é uma falha benigna — a chamada é recusada e a
 * pessoa acrescenta a rota. Divergir para "mais permitido" não tem volta.
 *
 * O teste garante o outro lado: toda entrada da lista aponta para rota que
 * existe, então a lista não apodrece em silêncio.
 */

export interface RotaPermitida {
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Padrão com `:param`, comparado por segmento. */
  padrao: string;
  /** Por que está aqui, e o que ela faz. Vai na descrição da tool. */
  motivo: string;
  /** `true` quando a chamada altera estado — o cliente MCP usa para pedir confirmação. */
  escreve: boolean;
  /**
   * `true` quando a chamada destrói informação sem caminho de volta.
   *
   * Não é o mesmo que `escreve`, e a diferença é o desenho inteiro deste
   * projeto: `DELETE /habits/:id` escreve e **não** é irreversível, porque apaga
   * logicamente e existe `/restore`. `PUT /habits/:id` escreve e **é**
   * irreversível, porque sobrescreve o título anterior e não há histórico.
   *
   * É desta coluna que a anotação `destructiveHint` da tool é DERIVADA. No dia
   * em que edição ganhar histórico, a coluna vira `false` e a anotação acompanha
   * sozinha — em vez de alguém ter de lembrar de mudar as duas.
   */
  irreversivel: boolean;
}

/**
 * O alcance do assistente. Lista fechada.
 *
 * Ausências deliberadas, e cada uma tem motivo:
 *
 * - `POST /auth/register` e `POST /auth/login`: criar conta ou trocar credencial
 *   não é assunto de assistente, e o token dele já é o da pessoa.
 * - `PUT /auth/profile`: mudar e-mail é mudar identidade.
 * - `POST /mcp`: recursão. Sem isto, uma chamada poderia abrir outra sessão MCP.
 * - `GET /health`: não é dado da pessoa, e o cliente não precisa.
 *
 * Note que `DELETE /habits/:id` **está** aqui, e é seguro estar: desde a migração
 * de soft delete ele apaga logicamente e é reversível por `/restore`. O delete
 * físico não é rota — é o script `npm run purge`. Proteção topológica: não há o
 * que permitir ou negar, porque não existe endpoint.
 */
export const ROTAS_PERMITIDAS: readonly RotaPermitida[] = [
  {
    metodo: 'GET',
    padrao: '/api/v1/habits',
    motivo: 'lista os hábitos ativos',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/habits/:id',
    motivo: 'detalha um hábito',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/habits/:habitId/checkins',
    motivo: 'lista check-ins de um hábito',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/habits/:habitId/stats',
    motivo: 'estatística determinística do hábito',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/insights/adherence',
    motivo: 'relatório de aderência com resumo redigido',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/insights/reschedule-proposals',
    motivo: 'propostas de reagendamento assinadas',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/habits',
    motivo: 'cria hábito',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'PUT',
    padrao: '/api/v1/habits/:id',
    motivo: 'edita título, descrição ou dias — reversível por /revisions/:id/restore',
    escreve: true,
    // Era `true`, e a migração `historico_de_edicao` a tornou `false`: cada
    // edição grava o estado anterior em `habit_revisions`, na mesma transação.
    // Isto é a anotação derivada funcionando como prometido — ninguém tocou em
    // `primitivas.ts`, e `destructiveHint` mudou porque esta linha mudou.
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/habits/:habitId/checkin',
    motivo: 'marca check-in (409 se já existe no dia)',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'DELETE',
    padrao: '/api/v1/habits/:habitId/checkins/:id',
    motivo: 'desfaz check-in — LÓGICO, reversível por /restore',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/habits/:habitId/checkins/:id/restore',
    motivo: 'refaz um check-in desfeito',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'DELETE',
    padrao: '/api/v1/habits/:id',
    motivo: 'apaga hábito — LÓGICO, reversível por /restore; o físico é npm run purge',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/habits/:id/restore',
    motivo: 'restaura hábito apagado logicamente',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/habits/:id/revisions',
    motivo: 'histórico de edições, da mais recente para a mais antiga',
    escreve: false,
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/habits/:id/revisions/:revisionId/restore',
    motivo: 'volta o hábito a uma versão anterior — grava revisão também',
    escreve: true,
    irreversivel: false,
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/insights/reschedule-proposals/confirm',
    motivo: 'aplica proposta assinada — reversível por /revisions/:id/restore',
    escreve: true,
    // Passa pelo MESMO `update` do repositório que o PUT, e por isso ganhou o
    // histórico sem código próprio. Era o argumento de usar um caminho de escrita
    // só: um segundo seria um segundo lugar de onde esquecer o snapshot.
    irreversivel: false,
  },
] as const;

/**
 * As rotas que existem e **não** estão no alcance, cada uma com o motivo.
 *
 * Esta lista não é lida por nada em produção — ela existe para o gate. O teste
 * enumera o stack do Express e exige que **toda** rota registrada esteja em
 * `ROTAS_PERMITIDAS` ou aqui. Sem isso, rota nova nasce sem classificação: não
 * permitida (então segura hoje) e invisível (então ninguém decide amanhã).
 *
 * É o mesmo problema da lista literal do parágrafo acima, resolvido do outro
 * lado: em vez de derivar a permissão do que existe — que faria rota nova nascer
 * permitida — o gate deriva a **obrigação de classificar**. Rota nova quebra o
 * teste até alguém escrever para qual lista ela vai. A decisão continua humana; o
 * que deixa de ser opcional é tomá-la.
 */
export const ROTAS_NEGADAS: readonly { metodo: string; padrao: string; motivo: string }[] = [
  {
    metodo: 'POST',
    padrao: '/api/v1/auth/register',
    motivo: 'criar conta não é assunto de assistente',
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/auth/login',
    motivo: 'o assistente já opera com o token de quem abriu a sessão',
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/auth/me',
    motivo: 'o assistente já sabe de quem é a sessão — o userId vem do JWT',
  },
  {
    metodo: 'PUT',
    padrao: '/api/v1/auth/profile',
    motivo: 'mudar e-mail é mudar identidade, e identidade é decisão direta da pessoa',
  },
  {
    metodo: 'POST',
    padrao: '/mcp',
    motivo: 'recursão: uma chamada abriria outra sessão MCP dentro desta',
  },
  {
    // `router.all('/')` responde 405 a tudo que não é POST, e o Express registra
    // isso como o método `_all`. O enumerador o traduz para `*`, então a entrada
    // que o classifica também precisa ser `*` — não GET e DELETE, que foi o que
    // eu escrevi primeiro e o teste apontou como rota inexistente.
    metodo: '*',
    padrao: '/mcp',
    motivo: 'o 405 do transporte sem sessão; nada a alcançar',
  },
  {
    metodo: 'GET',
    padrao: '/health',
    motivo: 'não é dado da pessoa, e o assistente não decide nada com isso',
  },
  {
    metodo: 'GET',
    padrao: '/api-docs.json',
    motivo: 'já chega pelo recurso habits://openapi, sem gastar uma chamada',
  },
  // ── O assistente conversacional do dashboard ────────────────────────────────
  //
  // TODAS negadas, e o motivo é o mesmo para as seis: **recursão**.
  //
  // A primitiva `request` é o que o assistente usa para agir. Se ela pudesse
  // chamar o próprio assistente, uma conversa poderia abrir outra conversa, que
  // proporia ações, que abririam outra — um laço de custo sem teto que nenhum dos
  // dois limites pega, porque cada nível parece uma conversa legítima.
  //
  // É a mesma decisão que negou `POST /mcp` a si mesmo, e pela mesma razão. Ler o
  // histórico de conversa continua possível pela primitiva `query`, que é leitura
  // de verdade e passa pela RLS.
  {
    metodo: 'GET',
    padrao: '/api/v1/assistant/status',
    motivo: 'recursão: o assistente não precisa saber de si mesmo',
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/assistant/conversations',
    motivo: 'recursão; o histórico é legível por `query`, que passa pela RLS',
  },
  {
    metodo: 'GET',
    padrao: '/api/v1/assistant/conversations/:id',
    motivo: 'recursão; idem',
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/assistant/messages',
    motivo: 'recursão: uma conversa abriria outra, e o custo não teria teto',
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/assistant/actions/:id/approve',
    motivo: 'aprovar a própria proposta é o oposto do desenho — a decisão é da pessoa',
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/assistant/actions/:id/reject',
    motivo: 'idem: decidir sobre a própria proposta',
  },
  {
    metodo: 'POST',
    padrao: '/api/v1/assistant/conversations/:id/resume',
    motivo: 'recursão: retomaria a si mesmo sem limite de profundidade',
  },
];

/**
 * A anotação `destructiveHint` da tool `request`, DERIVADA da lista.
 *
 * O peer argumentou — com razão no princípio — que `destructiveHint` no MCP
 * significa mudança **irreversível**, não mudança qualquer, e que anunciar `true`
 * numa tool que também faz `GET` fabrica confirmação em toda chamada. Confirmação
 * que aparece sempre é confirmação que a pessoa aprende a aprovar sem ler, e num
 * desenho em que a decisão migrou do servidor para o cliente essa habituação
 * corrói a única defesa que resta.
 *
 * Onde a premissa dele estava incompleta: ele afirmou que **nada** alcançável era
 * irreversível, porque o delete é lógico. O delete era. `PUT /habits/:id` e o
 * `confirm` do reagendamento não eram — os dois sobrescreviam sem histórico. O
 * soft delete cobriu exclusão e deixou edição de fora.
 *
 * ## E então a derivação fez o que era para fazer
 *
 * A migração `historico_de_edicao` fechou as duas: cada edição grava o estado
 * anterior em `habit_revisions`, na mesma transação, e volta por
 * `POST /habits/:id/revisions/:revisionId/restore`. As duas linhas viraram
 * `irreversivel: false`, e **`destructiveHint` virou `false` sozinho** — ninguém
 * editou `primitivas.ts`.
 *
 * Isto é o valor da derivação em vez da constante, observado e não argumentado: a
 * anotação escrita à mão teria continuado `true`, e o cliente seguiria pedindo
 * confirmação para um `GET` — a habituação que corrói a confirmação, que era
 * justamente a objeção. Hoje `ALCANCE_TEM_IRREVERSIVEL` é `false`, e o dia em que
 * uma rota irreversível entrar na lista ela volta a ser `true` sem ninguém
 * lembrar de nada.
 */
export const ALCANCE_TEM_IRREVERSIVEL = ROTAS_PERMITIDAS.some((rota) => rota.irreversivel);

export interface RespostaDeRequest {
  status: number;
  corpo: unknown;
}

export interface GatewayDeRequest {
  chamar(input: {
    token: string;
    metodo: string;
    path: string;
    corpo?: unknown;
  }): Promise<RespostaDeRequest>;
}

const TAMANHO_MAXIMO_DO_CORPO = 16 * 1024;

export class HttpRequestGateway implements GatewayDeRequest {
  /**
   * `baseUrl` é do LOOPBACK deste processo, e resolvida a cada chamada.
   *
   * A tool recebe só o path, nunca um host. Se recebesse URL completa, esta
   * primitiva seria um SSRF: o modelo poderia alcançar metadados de nuvem, rede
   * interna ou qualquer endereço. É o guardião mais barato e o mais importante.
   *
   * A resolução é tardia de propósito — `enderecoLocal()` só sabe a porta real
   * depois do `listen`, e o gateway é construído antes. Fixar no construtor
   * congelaria o palpite de `env.PORT`. Ver `endereco.ts`.
   */
  constructor(private readonly baseUrl?: string) {}

  async chamar({
    token,
    metodo,
    path,
    corpo,
  }: {
    token: string;
    metodo: string;
    path: string;
    corpo?: unknown;
  }): Promise<RespostaDeRequest> {
    const metodoNormalizado = metodo.toUpperCase();
    const semQuery = path.split('?')[0] ?? path;

    if (!path.startsWith('/')) {
      throw new BadRequestError('O path precisa começar com "/". Host não é aceito.');
    }
    // `..` em path pode escapar do prefixo depois da normalização do servidor.
    if (semQuery.includes('..')) {
      throw new BadRequestError('Path com ".." não é aceito.');
    }

    const rota = ROTAS_PERMITIDAS.find(
      (candidata) =>
        candidata.metodo === metodoNormalizado && casaPadrao(candidata.padrao, semQuery)
    );

    if (!rota) {
      throw new ForbiddenError(
        `${metodoNormalizado} ${semQuery} não está no alcance do assistente. ` +
          'Ver ROTAS_PERMITIDAS em src/mcp/request.ts.'
      );
    }

    const corpoSerializado = corpo === undefined ? undefined : JSON.stringify(corpo);
    if (corpoSerializado && corpoSerializado.length > TAMANHO_MAXIMO_DO_CORPO) {
      throw new BadRequestError('Corpo acima de 16 KB.');
    }

    const resposta = await this.enviar(metodoNormalizado, path, corpoSerializado, token);

    const texto = await resposta.text();
    return {
      status: resposta.status,
      corpo: texto.length === 0 ? null : seguroComoJson(texto),
    };
  }

  /**
   * Envia, e tenta UMA vez de novo quando a conexão falha — só em `GET`.
   *
   * ## Por que existe
   *
   * `fetch` no Node é undici, e ele mantém pool keep-alive por origem. Um socket
   * do pool pode estar morto sem o cliente saber: o servidor reiniciou, um
   * balanceador reciclou a conexão, o processo do outro lado caiu e voltou. A
   * primeira chamada a reusar esse socket recebe `read ECONNRESET` — e o erro
   * aparece como falha da aplicação quando é falha de uma conexão obsoleta.
   *
   * Reproduzido de forma determinística: fechar o servidor e reabrir na mesma
   * porta faz a próxima chamada estourar. E depende do ambiente — em Node puro o
   * undici se recupera sozinho, dentro do Jest não. Um comportamento que muda com
   * o runtime é exatamente o que não se deve deixar como pressuposto.
   *
   * ## Por que SÓ em GET
   *
   * `ECONNRESET` não diz se a requisição chegou ao servidor. Repetir um `POST`
   * poderia criar dois check-ins, e repetir um `DELETE` já aplicado é inócuo mas
   * repetir um `POST /restore`... também. O problema não é o efeito de cada rota:
   * é que **não se sabe** se a primeira tentativa foi aplicada.
   *
   * `GET` é idempotente por contrato, então repetir é seguro por definição.
   * Escrita falha alto, e quem decide se tenta de novo é a pessoa — que é a mesma
   * fronteira do resto deste desenho.
   */
  private async enviar(
    metodo: string,
    path: string,
    corpoSerializado: string | undefined,
    token: string
  ): Promise<Response> {
    try {
      return await this.dispararUmaVez(metodo, path, corpoSerializado, token);
    } catch (erro) {
      if (metodo !== 'GET' || !ehFalhaDeConexao(erro)) {
        throw erro;
      }
      // A segunda tentativa não reusa o socket morto: o undici o descarta ao
      // detectar a falha, então esta abre conexão nova.
      return this.dispararUmaVez(metodo, path, corpoSerializado, token);
    }
  }

  private dispararUmaVez(
    metodoNormalizado: string,
    path: string,
    corpoSerializado: string | undefined,
    token: string
  ): Promise<Response> {
    return fetch(`${this.baseUrl ?? enderecoLocal()}${path}`, {
      method: metodoNormalizado,
      headers: {
        // O token vem do JWT de quem abriu a sessão MCP. A tool NÃO aceita
        // header do cliente: se aceitasse, o modelo poderia apresentar outra
        // credencial, e o escopo por usuário viraria sugestão.
        Authorization: `Bearer ${token}`,
        // A proveniência do registro. Sempre presente, em toda chamada desta
        // primitiva — é o que garante que escrita do assistente nunca seja
        // gravada como se fosse da pessoa. Ver `origem.ts`.
        [CABECALHO_DE_ORIGEM]: 'assistant',
        // A prova de que a marca vem DESTE processo, e não de um cliente que a
        // digitou. Ver `origem.ts` para por que o segredo é por processo.
        [CABECALHO_DE_PROVA]: provaDeOrigem(),
        ...(corpoSerializado ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpoSerializado ? { body: corpoSerializado } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  }
}

/**
 * Falha de CONEXÃO, e não resposta de erro.
 *
 * O `fetch` embrulha erros de rede num `TypeError: fetch failed` com o motivo
 * real em `cause`. Sem olhar a `cause`, um `AbortError` de timeout e um
 * `ECONNRESET` de socket obsoleto seriam indistinguíveis — e repetir depois de um
 * timeout de 15s dobraria a espera em vez de consertar nada.
 */
function ehFalhaDeConexao(erro: unknown): boolean {
  const causa = (erro as { cause?: { code?: string } } | undefined)?.cause;
  return causa?.code === 'ECONNRESET' || causa?.code === 'ECONNREFUSED' || causa?.code === 'EPIPE';
}

/** Compara por segmento; `:param` casa com um segmento não vazio. */
function casaPadrao(padrao: string, path: string): boolean {
  const doPadrao = padrao.split('/');
  const doPath = path.replace(/\/+$/, '').split('/');

  if (doPadrao.length !== doPath.length) return false;

  return doPadrao.every((segmento, i) =>
    segmento.startsWith(':') ? (doPath[i]?.length ?? 0) > 0 : segmento === doPath[i]
  );
}

function seguroComoJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}
