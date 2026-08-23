import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { app } from '@/app';
import { registerReadOnlyTools, TOOLS_SOMENTE_LEITURA } from '@/mcp/tools';
import { registrarPrimitivas, registrarRecursos, PRIMITIVAS } from '@/mcp/primitivas';
import {
  ALCANCE_TEM_IRREVERSIVEL,
  HttpRequestGateway,
  ROTAS_NEGADAS,
  ROTAS_PERMITIDAS,
} from '@/mcp/request';
import {
  CABECALHO_DE_ORIGEM,
  CABECALHO_DE_PROVA,
  origemDaRequisicao,
  provaDeOrigem,
} from '@/mcp/origem';
import type { GatewayDeQuery } from '@/mcp/query';
import type { GatewayDeRequest } from '@/mcp/request';
import type { ReadOnlyHabitsGateway } from '@/mcp/gateway';
import { adherenceReport } from '../insights/fixtures';

const USER_ID = 'user-1';
const OUTRO_USUARIO = 'user-2';
const TOKEN = 'token-de-quem-abriu-a-sessao';

function gatewaysFalsos() {
  return {
    leitura: {
      listHabits: jest.fn().mockResolvedValue([]),
      getHabit: jest.fn().mockResolvedValue(null),
      getStats: jest.fn().mockResolvedValue({}),
      listCheckins: jest.fn().mockResolvedValue([]),
      getAdherenceReport: jest.fn().mockResolvedValue(adherenceReport()),
    } as jest.Mocked<ReadOnlyHabitsGateway>,
    query: {
      executar: jest.fn().mockResolvedValue({ linhas: [], total: 0, truncado: false }),
    } as jest.Mocked<GatewayDeQuery>,
    request: {
      chamar: jest.fn().mockResolvedValue({ status: 200, corpo: { status: 'success', data: [] } }),
    } as jest.Mocked<GatewayDeRequest>,
  };
}

/**
 * Monta o servidor como o **router monta**: tools nomeadas, primitivas e
 * recursos, juntos.
 *
 * `tools.test.ts` registra só as tools nomeadas, e por isso a lista fechada dele
 * continua verde por construção — ele não pode ver uma tool acrescentada em
 * `server.ts`. Este arquivo olha a superfície inteira, que é a que um assistente
 * externo enxerga. É a distinção entre verificar o módulo e verificar o produto.
 */
async function conectar({
  comQuery = true,
  userId = USER_ID,
}: { comQuery?: boolean; userId?: string } = {}) {
  const g = gatewaysFalsos();
  const server = new McpServer({ name: 'habits-mcp-teste', version: '0.0.0' });

  registerReadOnlyTools(server, g.leitura, userId);
  registrarPrimitivas(server, {
    gatewayDeQuery: comQuery ? g.query : null,
    gatewayDeRequest: g.request,
    userId,
    token: TOKEN,
  });
  registrarRecursos(server, {
    gatewayDeQuery: comQuery ? g.query : null,
    userId,
    openapi: { openapi: '3.0.0', paths: {} },
  });

  const client = new Client({ name: 'cliente-de-teste', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);

  return {
    client,
    ...g,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe('INV-25 — a superfície anunciada é exatamente a declarada', () => {
  it('INV-25: o servidor completo anuncia as tools nomeadas mais as duas primitivas', async () => {
    // O caso vizinho que faltava: uma tool registrada em `server.ts` e ausente
    // das duas listas cai aqui, e só aqui.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();

      expect(tools.map((t) => t.name).sort()).toEqual(
        [...TOOLS_SOMENTE_LEITURA, ...PRIMITIVAS].sort()
      );
    } finally {
      await close();
    }
  });

  it('INV-25: `request` é a ÚNICA tool que não se declara somente leitura', async () => {
    // A propriedade que importa para o cliente: ele decide pedir confirmação pela
    // anotação. Se uma segunda tool de escrita aparecer sem anotar, este caso cai.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      const escrevem = tools.filter((t) => t.annotations?.readOnlyHint !== true);

      expect(escrevem.map((t) => t.name)).toEqual(['request']);
      expect(escrevem[0]!.annotations).toMatchObject({ openWorldHint: false });
    } finally {
      await close();
    }
  });

  it('INV-31: `destructiveHint` é DERIVADO da allowlist, não escrito à mão', async () => {
    // Este caso é o que torna a derivação observável em vez de uma intenção no
    // comentário. Ele afirma a relação, não o valor: hoje nenhuma rota é
    // irreversível e a anotação é `false`; se alguma passar a ser, ela vira `true`
    // e este caso continua verde — enquanto um caso que afirmasse `false`
    // reprovaria e alguém "consertaria" mudando o número em vez da causa.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      const requestTool = tools.find((t) => t.name === 'request')!;

      expect(requestTool.annotations?.destructiveHint).toBe(ALCANCE_TEM_IRREVERSIVEL);
      expect(ALCANCE_TEM_IRREVERSIVEL).toBe(ROTAS_PERMITIDAS.some((r) => r.irreversivel));
    } finally {
      await close();
    }
  });

  it('INV-31: nenhuma rota é irreversível, e as que sobrescrevem nomeiam a volta', () => {
    // O par do caso de cima: ele amarra a anotação à lista, este amarra a lista à
    // realidade. Uma rota marcada `irreversivel: false` sem caminho de volta seria
    // a lista mentindo, e a anotação herdaria a mentira sem nada acusar.
    //
    // A conferência é sobre o `motivo` porque ele é o texto que vai para o recurso
    // `habits://rotas`: se ele não nomear a volta, quem confirma a chamada não
    // sabe que existe uma.
    //
    // A primeira versão deste caso usava a regex `/revers|restore|desfa/` sobre o
    // motivo de TODA rota de escrita, e reprovou nas três rotas de `/restore` —
    // que não precisam nomear caminho de volta porque **são** o caminho de volta.
    // O critério certo não é textual: é o que a rota faz com dado que já existe.
    const cria = (rota: (typeof ROTAS_PERMITIDAS)[number]) =>
      rota.metodo === 'POST' &&
      (rota.padrao.endsWith('/habits') || rota.padrao.endsWith('/checkin'));
    const ehVolta = (rota: (typeof ROTAS_PERMITIDAS)[number]) => rota.padrao.endsWith('/restore');

    // Sobrescreve ou remove dado existente: PUT, os dois DELETE, e o confirm.
    const sobrescrevem = ROTAS_PERMITIDAS.filter(
      (rota) => rota.escreve && !cria(rota) && !ehVolta(rota)
    );
    const semVoltaNomeada = sobrescrevem.filter((rota) => !/revers|restore/i.test(rota.motivo));

    expect(ROTAS_PERMITIDAS.filter((r) => r.irreversivel)).toEqual([]);
    // O caso vizinho embutido: se este filtro ficar vazio por engano — porque
    // alguém renomeou os padrões, por exemplo — a asserção de baixo passaria sem
    // examinar nada.
    expect(sobrescrevem.map((r) => `${r.metodo} ${r.padrao}`).sort()).toEqual([
      'DELETE /api/v1/habits/:habitId/checkins/:id',
      'DELETE /api/v1/habits/:id',
      'POST /api/v1/insights/reschedule-proposals/confirm',
      'PUT /api/v1/habits/:id',
    ]);
    expect(semVoltaNomeada.map((r) => `${r.metodo} ${r.padrao}`)).toEqual([]);
  });

  it('INV-25: nenhuma tool abre a porta para fora do processo', async () => {
    // `openWorldHint: false` em TODAS. `request` fala com o loopback; `query`, com
    // o Postgres local. Se alguma passar a alcançar a internet, tem de anunciar.
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.annotations?.openWorldHint).toBe(false);
      }
    } finally {
      await close();
    }
  });

  it('INV-15: sem conexão somente-leitura, `query` desaparece e o resto continua', async () => {
    // A mesma degradação da camada de IA: falta de configuração tira a capacidade,
    // não a aplicação. Anunciar `query` e falhar em toda chamada seria pior — o
    // assistente tentaria, e a pessoa veria erro em vez de ausência.
    const { client, close } = await conectar({ comQuery: false });
    try {
      const nomes = (await client.listTools()).tools.map((t) => t.name);
      const uris = (await client.listResources()).resources.map((r) => r.uri);

      expect(nomes).not.toContain('query');
      expect(nomes).toContain('request');
      expect(uris).not.toContain('habits://schema');
      expect(uris).toEqual(expect.arrayContaining(['habits://rotas', 'habits://openapi']));
    } finally {
      await close();
    }
  });
});

describe('INV-03/INV-10 — as primitivas não têm porta própria de identidade', () => {
  it('INV-03: adversário — userId no argumento de `query` é ignorado', async () => {
    const { client, query, close } = await conectar();
    try {
      await client.callTool({
        name: 'query',
        arguments: { sql: 'SELECT 1', userId: OUTRO_USUARIO },
      });

      expect(query.executar).toHaveBeenCalledWith(USER_ID, 'SELECT 1');
    } finally {
      await close();
    }
  });

  it('INV-10: adversário — token no argumento de `request` é ignorado', async () => {
    // O ataque mais direto contra esta primitiva: apresentar outra credencial. O
    // token vem por closure do cabeçalho da sessão, e o argumento não tem para
    // onde ir — o schema nem o declara.
    const { client, request, close } = await conectar();
    try {
      await client.callTool({
        name: 'request',
        arguments: {
          metodo: 'GET',
          path: '/api/v1/habits',
          token: 'token-de-outra-pessoa',
          Authorization: 'Bearer invasor',
        },
      });

      expect(request.chamar).toHaveBeenCalledWith({
        token: TOKEN,
        metodo: 'GET',
        path: '/api/v1/habits',
        corpo: undefined,
      });
    } finally {
      await close();
    }
  });

  it('INV-10: nenhuma primitiva declara token, userId ou host no schema de entrada', async () => {
    const { client, close } = await conectar();
    try {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        const propriedades = Object.keys(
          (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
        );
        expect(propriedades).not.toContain('userId');
        expect(propriedades).not.toContain('token');
        expect(propriedades).not.toContain('host');
        expect(propriedades).not.toContain('baseUrl');
        expect(propriedades).not.toContain('url');
      }
    } finally {
      await close();
    }
  });

  it('`request` devolve o status junto do corpo', async () => {
    // 409 é duplicata e 404 é hábito apagado: o significado está no status. Sem
    // ele, o assistente teria de inferir do corpo o que aconteceu.
    const { client, request, close } = await conectar();
    try {
      request.chamar.mockResolvedValue({ status: 409, corpo: { message: 'já existe' } });

      const r = (await client.callTool({
        name: 'request',
        arguments: { metodo: 'POST', path: '/api/v1/habits/h1/checkin' },
      })) as { content: { text: string }[] };

      expect(JSON.parse(r.content[0]!.text).status).toBe(409);
    } finally {
      await close();
    }
  });
});

describe('INV-26 — toda rota do Express é classificada', () => {
  /**
   * Enumera o stack do Express, incluindo os routers montados.
   *
   * Isto é derivação, e é o oposto da allowlist: a permissão continua literal
   * (rota nova não nasce permitida), mas a **obrigação de classificar** é
   * derivada do que existe. Rota nova quebra este teste até alguém decidir.
   */
  function rotasDoExpress(): { metodo: string; padrao: string }[] {
    const encontradas: { metodo: string; padrao: string }[] = [];

    type Camada = {
      route?: { path: string; methods: Record<string, boolean> };
      name?: string;
      handle?: { stack?: Camada[] };
      regexp?: RegExp;
    };

    /**
     * O prefixo de um router montado só existe no `regexp` da camada.
     *
     * `app.use('/api/v1', r)` produz `/^\/api\/v1\/?(?=\/|$)/i`, e `app.use('/', r)`
     * produz `/^\/?(?=\/|$)/i`. Desmontar isso é feio, e a alternativa era eu
     * escrever os prefixos à mão aqui — que é a cópia que este gate existe para
     * evitar. Um `app.use` novo com prefixo novo continua sendo enumerado.
     */
    const prefixoDe = (regexp: RegExp | undefined): string => {
      const fonte = (regexp?.source ?? '')
        .replace(/^\^/, '')
        .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
        .replace(/\$$/, '');
      return fonte.replace(/\\\//g, '/');
    };

    const percorrer = (stack: Camada[], prefixo: string) => {
      for (const camada of stack) {
        if (camada.route) {
          for (const metodo of Object.keys(camada.route.methods)) {
            const caminho = `${prefixo}${camada.route.path}`.replace(/\/$/, '') || '/';
            // `router.all()` vira o método `_all` no Express, e o classificador
            // precisa da mesma marca — foi a primeira coisa que este gate pegou,
            // no meu próprio `ROTAS_NEGADAS`, que listava GET e DELETE /mcp.
            encontradas.push({
              metodo: metodo === '_all' ? '*' : metodo.toUpperCase(),
              padrao: caminho,
            });
          }
          continue;
        }
        if (camada.name === 'router' && camada.handle?.stack) {
          percorrer(camada.handle.stack, prefixo + prefixoDe(camada.regexp));
        }
      }
    };

    // `_router`, e NUNCA `app.router`: no Express 4 esse getter LANÇA por
    // compatibilidade com o 3.x, então um `app.router ?? app._router` estoura
    // antes de chegar ao segundo operando. Foi o que aconteceu na primeira versão
    // deste gate, e o sintoma era "o enumerador não acha rota".
    const raiz = app as unknown as { _router: { stack: Camada[] } };
    percorrer(raiz._router.stack, '');
    return encontradas;
  }

  function normalizar(padrao: string) {
    // `:id` e `:habitId` são o mesmo para efeito de classificação: o que importa
    // é a forma da rota, não o nome do parâmetro.
    return padrao.replace(/:[A-Za-z0-9_]+/g, ':p');
  }

  it('INV-26: o enumerador acha as rotas — se não achar nada, nada abaixo prova nada', () => {
    // O caso vizinho do próprio gate. Um enumerador que devolve lista vazia faz
    // todos os `for` seguintes passarem sem examinar coisa alguma; foi assim que
    // três verificações desta safra ficaram verdes olhando para o vazio.
    const rotas = rotasDoExpress();

    expect(rotas.length).toBeGreaterThanOrEqual(15);
    expect(rotas.map((r) => `${r.metodo} ${r.padrao}`)).toEqual(
      expect.arrayContaining(['GET /api/v1/habits', 'POST /api/v1/habits'])
    );
    expect(rotas.every((r) => r.padrao.startsWith('/'))).toBe(true);
  });

  it('INV-26: adversário — nenhuma rota existe sem estar permitida ou negada', () => {
    const classificadas = new Set(
      [...ROTAS_PERMITIDAS, ...ROTAS_NEGADAS].map((r) => `${r.metodo} ${normalizar(r.padrao)}`)
    );

    const orfas = rotasDoExpress()
      .map((r) => `${r.metodo} ${normalizar(r.padrao)}`)
      .filter((chave) => !classificadas.has(chave));

    // A mensagem carrega a lista porque quem quebrar este teste precisa saber
    // exatamente o que classificar, não que "o gate falhou".
    expect(orfas).toEqual([]);
  });

  it('INV-26: adversário — nenhuma entrada das listas aponta para rota inexistente', () => {
    // O outro lado: lista que apodrece. Uma rota removida deixa entrada morta, e
    // entrada morta na allowlist é permissão para algo que ninguém mais audita.
    const existentes = new Set(
      rotasDoExpress().map((r) => `${r.metodo} ${normalizar(r.padrao)}`)
    );

    const fantasmas = [...ROTAS_PERMITIDAS, ...ROTAS_NEGADAS]
      .map((r) => `${r.metodo} ${normalizar(r.padrao)}`)
      .filter((chave) => !existentes.has(chave));

    expect(fantasmas).toEqual([]);
  });

  it('INV-26: as duas listas não se sobrepõem', () => {
    const permitidas = new Set(ROTAS_PERMITIDAS.map((r) => `${r.metodo} ${r.padrao}`));
    const ambas = ROTAS_NEGADAS.filter((r) => permitidas.has(`${r.metodo} ${r.padrao}`));

    expect(ambas).toEqual([]);
  });

  it('INV-26: `escreve` casa com o método — GET não escreve, o resto escreve', () => {
    // Classificação errada dentro da lista: um POST marcado `escreve: false`
    // faria o cliente chamar sem confirmação. Amarrar ao método fecha a classe.
    const erradas = ROTAS_PERMITIDAS.filter((r) => r.escreve !== (r.metodo !== 'GET'));

    expect(erradas.map((r) => `${r.metodo} ${r.padrao}`)).toEqual([]);
  });

  it('INV-26: toda entrada negada tem motivo escrito', () => {
    expect(ROTAS_NEGADAS.filter((r) => r.motivo.trim().length < 10)).toEqual([]);
  });
});

describe('INV-28 — a proveniência é do servidor, e não pode sub-registrar', () => {
  it('INV-28: `assistant` exige o cabeçalho E a prova do processo', () => {
    const marca = { [CABECALHO_DE_ORIGEM]: 'assistant', [CABECALHO_DE_PROVA]: provaDeOrigem() };

    expect(origemDaRequisicao({ headers: marca })).toBe('assistant');
    expect(origemDaRequisicao({ headers: {} })).toBe('user');
    // Qualquer outro valor cai para `user`. O default seguro aqui é "da pessoa":
    // marcar como IA algo que não passou por ela seria inventar auditoria.
    expect(origemDaRequisicao({ headers: { ...marca, [CABECALHO_DE_ORIGEM]: 'sim' } })).toBe('user');
    expect(origemDaRequisicao({ headers: { ...marca, [CABECALHO_DE_ORIGEM]: 'ASSISTANT' } })).toBe(
      'user'
    );
  });

  it('INV-28: adversário — o cabeçalho SEM a prova é tratado como `user`', () => {
    // A direção que estava aberta e agora não está: quem tem o token podia
    // digitar o cabeçalho e atribuir à IA um registro que era dele. A prova é um
    // segredo de processo — quem chama de fora não tem como conhecê-lo.
    expect(origemDaRequisicao({ headers: { [CABECALHO_DE_ORIGEM]: 'assistant' } })).toBe('user');
  });

  it('INV-28: adversário — prova errada, vazia ou de tamanho diferente não passa', () => {
    // `timingSafeEqual` LANÇA com buffers de tamanhos diferentes, então o
    // comprimento é conferido antes. Este caso é o que garante que a conferência
    // devolve `false` em vez de derrubar a requisição com um 500.
    const casos = ['', 'nao-e-hex', '00', provaDeOrigem().slice(0, -2), provaDeOrigem() + 'ff'];

    for (const prova of casos) {
      expect(
        origemDaRequisicao({
          headers: { [CABECALHO_DE_ORIGEM]: 'assistant', [CABECALHO_DE_PROVA]: prova },
        })
      ).toBe('user');
    }
  });

  it('INV-28: adversário — a prova de um byte trocado não passa', () => {
    // O caso vizinho do comprimento: mesmo tamanho, conteúdo diferente. Sem ele,
    // uma comparação que só olhasse o tamanho passaria os cinco casos acima.
    const certa = provaDeOrigem();
    const trocada = (certa[0] === 'a' ? 'b' : 'a') + certa.slice(1);

    expect(trocada).toHaveLength(certa.length);
    expect(
      origemDaRequisicao({
        headers: { [CABECALHO_DE_ORIGEM]: 'assistant', [CABECALHO_DE_PROVA]: trocada },
      })
    ).toBe('user');
  });

  it('INV-28: adversário — o gateway marca TODA chamada, inclusive as de leitura', async () => {
    // A propriedade que fecha o sub-registro: não há caminho pela primitiva que
    // chegue à API sem a marca. Se alguém acrescentar um `if` que só marca as de
    // escrita, uma leitura passa a ser indistinguível de acesso humano — e o log
    // de "o que a IA olhou" deixa de existir.
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    const fetchOriginal = global.fetch;
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      chamadas.push({
        url: String(url),
        headers: ((init as { headers: Record<string, string> }).headers ?? {}) as Record<
          string,
          string
        >,
      });
      return { status: 200, text: async () => '{}' } as Response;
    }) as unknown as typeof fetch;

    try {
      const gateway = new HttpRequestGateway('http://127.0.0.1:1');
      await gateway.chamar({ token: TOKEN, metodo: 'GET', path: '/api/v1/habits' });
      await gateway.chamar({
        token: TOKEN,
        metodo: 'POST',
        path: '/api/v1/habits',
        corpo: { title: 'x' },
      });

      expect(chamadas).toHaveLength(2);
      for (const chamada of chamadas) {
        expect(chamada.headers[CABECALHO_DE_ORIGEM]).toBe('assistant');
        // E a prova junto — sem ela o middleware trataria como `user`, e o
        // sub-registro que este desenho fecha voltaria a existir.
        expect(chamada.headers[CABECALHO_DE_PROVA]).toBe(provaDeOrigem());
        expect(chamada.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      }
    } finally {
      global.fetch = fetchOriginal;
    }
  });

  it('INV-28: adversário — o gateway nunca aceita Authorization de quem chama a tool', async () => {
    // O token é o da sessão. Este caso é o par estático do de integração: mesmo
    // que um argumento carregasse cabeçalho, ele não tem por onde entrar.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'mcp', 'request.ts'),
      'utf8'
    );

    // O único `Authorization` do arquivo é o construído a partir de `token`.
    const ocorrencias = fonte.match(/Authorization/g) ?? [];
    expect(ocorrencias).toHaveLength(1);
    expect(fonte).toMatch(/Authorization: `Bearer \$\{token\}`/);
  });
});

describe('recursos de descoberta — derivados, não copiados', () => {
  it('habits://rotas serve a MESMA constante que o gateway confere', async () => {
    // Se o recurso tivesse cópia própria, ele descreveria um alcance que não é o
    // real — e o cliente confiaria na descrição em vez do comportamento.
    const { client, close } = await conectar();
    try {
      const r = await client.readResource({ uri: 'habits://rotas' });

      expect(JSON.parse(r.contents[0]!.text as string)).toEqual(
        JSON.parse(JSON.stringify(ROTAS_PERMITIDAS))
      );
    } finally {
      await close();
    }
  });

  it('habits://schema é lido do catálogo do Postgres, não de uma lista escrita à mão', async () => {
    const { client, query, close } = await conectar();
    try {
      await client.readResource({ uri: 'habits://schema' });

      const [, sql] = query.executar.mock.calls[0]!;
      expect(sql).toMatch(/information_schema\.columns/);
      expect(query.executar).toHaveBeenCalledWith(USER_ID, expect.any(String));
    } finally {
      await close();
    }
  });

  it('adversário — o arquivo das primitivas não importa service nem repositório', () => {
    // Mesma barreira estática de `tools.ts`: um import de service aqui daria
    // caminho de escrita que não passa pela allowlist nem pela validação da rota.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'mcp', 'primitivas.ts'),
      'utf8'
    );

    expect(fonte).not.toMatch(/from\s+'@\/services\//);
    expect(fonte).not.toMatch(/from\s+'@\/repositories\//);
    expect(fonte).not.toMatch(/PrismaClient/);
  });
});
