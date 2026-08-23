import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '@/app';
import { prisma } from '@/config/database';
import { criarGatewayDeQuery } from '@/mcp/query';
import { HttpRequestGateway, ROTAS_PERMITIDAS } from '@/mcp/request';
import { esquecerEnderecoLocal, registrarEnderecoLocal } from '@/mcp/endereco';
import { aguardarFechamentos } from '@/mcp/fechamentos';
import { recursosAtivos } from '../lib/fechar-pool-http';
import {
  erroDePortaOcupada,
  MENOR_PORTA_EFEMERA_CONHECIDA,
  PORTA_FIXA_DE_TESTE,
} from '../lib/porta-fixa';
import { TABELAS_EXPOSTAS, TABELAS_NAO_EXPOSTAS } from '@/mcp/tabelas';
import { addUtcDays, toDayKey, utcStartOfDay } from '@/utils/helpers';

/**
 * As primitivas do MCP — Camada 2.
 *
 * Aqui só o banco real prova o que importa: que a role somente-leitura não
 * escreve **por permissão** e que o RLS isola **por política**, em vez de por
 * validação da consulta. Nenhum destes casos poderia rodar com dublê.
 */
const prismaCru = new PrismaClient();
const gatewayDeQuery = criarGatewayDeQuery();

/**
 * O gateway fala HTTP de verdade, então o teste precisa de um servidor de
 * verdade — numa porta efêmera.
 *
 * A primeira versão usava o default do gateway, `127.0.0.1:${env.PORT}`, e batia
 * no CONTAINER de desenvolvimento: outro processo, outro banco, outro
 * `JWT_SECRET`. O resultado era 401, e o diagnóstico apontava para autenticação
 * em vez de para o endereço. É a décima terceira instância outra vez —
 * instrumento certo, ambiente errado.
 */
let servidor: ReturnType<typeof app.listen>;
let gatewayDeRequest: HttpRequestGateway;

beforeAll(async () => {
  // Porta FIXA, e fora da faixa efêmera. `listen(0)` deixava o pool keep-alive do
  // `fetch` com um socket para uma porta que o SO recicla — e a colisão com a
  // porta nova de um supertest posterior produzia `read ECONNRESET` num arquivo
  // sem relação. Ver `tests/lib/porta-fixa.ts`.
  await new Promise<void>((resolve, reject) => {
    servidor = app
      .listen(PORTA_FIXA_DE_TESTE, () => resolve())
      .on('error', (erro: NodeJS.ErrnoException) => {
        reject(
          erro.code === 'EADDRINUSE' ? new Error(erroDePortaOcupada(PORTA_FIXA_DE_TESTE)) : erro
        );
      });
  });
  // O MESMO registro que `server.ts` faz depois do `listen`. Isto é o que torna
  // os casos abaixo uma prova da fiação real: sem ele, o gateway sairia para a
  // porta 3333 e encontraria o container de desenvolvimento.
  registrarEnderecoLocal(servidor);
  gatewayDeRequest = new HttpRequestGateway();
});

afterAll(async () => {
  // Drena os fechamentos que o endpoint MCP dispara sem aguardar. Sem isto eles
  // completam no meio do arquivo SEGUINTE — e `--detectOpenHandles` não os vê,
  // porque nada fica aberto no fim. Ver `src/mcp/fechamentos.ts`.
  await aguardarFechamentos();
  esquecerEnderecoLocal();
  // O client dedicado da primitiva tem pool próprio: sem isto o Jest não encerra.
  await gatewayDeQuery?.encerrar();
  // `servidor.close()` não fecha os sockets keep-alive que o `fetch` da primitiva
  // deixou no pool do undici, e não há como fechá-los de dentro do Jest — o
  // dispatcher vive num `globalThis` que o ambiente do teste não vê. O socket
  // obsoleto continua existindo; o que a porta fixa remove é a possibilidade de
  // ele COLIDIR. Ver `tests/lib/porta-fixa.ts`.
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await prismaCru.$disconnect();
});

async function registrar(email: string) {
  const r = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Primitiva', email, password: 'password123' });
  return { token: r.body.data.accessToken as string, userId: r.body.data.user.id as string };
}

async function criarHabito(token: string, title: string) {
  const r = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays: [] });
  return r.body.data.id as string;
}

describe('INV-27 — a escrita pela primitiva query é impossível por PERMISSÃO', () => {
  it('INV-27: adversário — escrita pela primitiva é recusada pela GRAMÁTICA do Postgres', async () => {
    // Barreira 1. O envelope `SELECT * FROM (…) AS sub` faz o Postgres recusar
    // escrita no parser DELE: `INSERT` cru dá erro de sintaxe, e CTE que escreve
    // dá "must be at the top level". Nada aqui inspeciona a consulta — a recusa
    // é do banco, e é por isso que ela não perde para paráfrase.
    const { userId } = await registrar('query-insert@example.com');

    for (const escrita of [
      `INSERT INTO habits (id, title, "userId", "createdAt", "updatedAt") VALUES ('x','y','${userId}',now(),now())`,
      'DELETE FROM checkins',
      "UPDATE habits SET title = 'invadido'",
      // A tentativa esperta: CTE que escreve e devolve. Sem o envelope ela
      // PASSARIA pela gramática, e só a permissão a barraria.
      `WITH escrita AS (INSERT INTO habits (id, title, "userId", "createdAt", "updatedAt") VALUES ('x','y','${userId}',now(),now()) RETURNING id) SELECT id FROM escrita`,
    ]) {
      await expect(gatewayDeQuery!.executar(userId, escrita)).rejects.toThrow(/A consulta falhou/);
    }
  });

  it('INV-27: adversário — e a PERMISSÃO barra a mesma escrita sem o envelope', async () => {
    // Barreira 2, e o caso que a barreira 1 tornou invisível.
    //
    // Com o envelope, escrita falha por sintaxe antes de chegar à permissão. Se o
    // teste só olhasse o caminho de cima, ele diria "a escrita falha" e deixaria
    // de provar POR QUÊ — e no dia em que alguém remover o envelope por
    // otimização, é a permissão que tem de estar de pé. Então este caso usa a
    // MESMA conexão somente-leitura, sem envelope.
    const semEnvelope = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_READONLY! } },
    });

    try {
      for (const escrita of [
        `INSERT INTO habits (id, title, "userId", "createdAt", "updatedAt") VALUES ('a','b','c',now(),now())`,
        'DELETE FROM checkins',
        "UPDATE habits SET title = 'invadido'",
        `WITH e AS (DELETE FROM checkins RETURNING id) SELECT id FROM e`,
      ]) {
        await expect(semEnvelope.$queryRawUnsafe(escrita)).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await semEnvelope.$disconnect();
    }
  });

  it('INV-27: adversário — DDL também falha', async () => {
    const { userId } = await registrar('query-ddl@example.com');

    await expect(gatewayDeQuery!.executar(userId, 'DROP TABLE checkins')).rejects.toThrow();
    await expect(gatewayDeQuery!.executar(userId, 'CREATE TABLE x (y int)')).rejects.toThrow();
  });
});

describe('INV-27 — o isolamento é por RLS, não por filtro na consulta', () => {
  it('INV-27: adversário — SELECT * FROM users devolve UMA linha, a de quem chamou', async () => {
    // A pior consulta que um modelo pode escrever. Ela é aceita, executa, e
    // devolve só a linha do dono — porque a política é do banco.
    const a = await registrar('rls-a@example.com');
    await registrar('rls-b@example.com');

    const resultado = await gatewayDeQuery!.executar(a.userId, 'SELECT id, email FROM users');

    expect(resultado.linhas).toHaveLength(1);
    expect((resultado.linhas[0] as { email: string }).email).toBe('rls-a@example.com');
  });

  it('INV-27: adversário — não há JOIN que alcance check-in de outra pessoa', async () => {
    const a = await registrar('rls-join-a@example.com');
    const b = await registrar('rls-join-b@example.com');
    const habitoDeB = await criarHabito(b.token, 'De B');
    await request(app)
      .post(`/api/v1/habits/${habitoDeB}/checkin`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({});

    const resultado = await gatewayDeQuery!.executar(
      a.userId,
      `SELECT c.id FROM checkins c JOIN habits h ON h.id = c."habitId" WHERE h."userId" = '${b.userId}'`
    );

    expect(resultado.linhas).toHaveLength(0);
  });

  it('INV-27: adversário — sem a variável de sessão, a política devolve ZERO linhas', async () => {
    // Falha fechada. `current_setting(…, true)` devolve NULL quando a variável não
    // existe, e NULL não casa com nada — então esquecer o `SET` produz vazio, não
    // vazamento. É a propriedade mais importante do desenho, e o único jeito de
    // prová-la é consultando por fora do gateway.
    const a = await registrar('rls-sem-set@example.com');
    await criarHabito(a.token, 'Existe');

    const semSet = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_READONLY! } },
    });
    try {
      const linhas = await semSet.$queryRawUnsafe<unknown[]>('SELECT id FROM habits');
      expect(linhas).toHaveLength(0);
    } finally {
      await semSet.$disconnect();
    }
  });

  it('INV-27: a consulta legítima funciona — é para isto que a primitiva existe', async () => {
    const a = await registrar('query-legitima@example.com');
    await criarHabito(a.token, 'Correr');
    await criarHabito(a.token, 'Ler');

    const resultado = await gatewayDeQuery!.executar(
      a.userId,
      'SELECT title FROM habits ORDER BY title'
    );

    expect(resultado.linhas.map((l) => (l as { title: string }).title)).toEqual(['Correr', 'Ler']);
    expect(resultado.truncado).toBe(false);
  });

  it('INV-27: adversário — vários comandos numa chamada são recusados', async () => {
    // Não é validação de conteúdo: é o que impede um `RESET` desfazer o SET no
    // mesmo lote. As garantias de escrita e escopo continuam sendo do banco.
    const a = await registrar('query-multi@example.com');

    await expect(
      gatewayDeQuery!.executar(a.userId, 'SELECT 1; RESET app.usuario_atual')
    ).rejects.toThrow(/um comando por vez/i);
  });
});

describe('INV-26 — a allowlist é o que separa alcance de alcance', () => {
  it('INV-26: rota permitida passa e carrega o token de quem abriu a sessão', async () => {
    const a = await registrar('request-ok@example.com');
    await criarHabito(a.token, 'Visível');

    const resposta = await gatewayDeRequest.chamar({
      token: a.token,
      metodo: 'GET',
      path: '/api/v1/habits',
    });

    expect(resposta.status).toBe(200);
    expect((resposta.corpo as { data: unknown[] }).data).toHaveLength(1);
  });

  it('INV-26: adversário — rota fora da lista é recusada antes de sair da aplicação', async () => {
    const a = await registrar('request-negada@example.com');

    await expect(
      gatewayDeRequest.chamar({ token: a.token, metodo: 'PUT', path: '/api/v1/auth/profile' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('adversário — /mcp é recusado: recursão fecharia o alcance sobre si mesmo', async () => {
    const a = await registrar('request-recursao@example.com');

    await expect(
      gatewayDeRequest.chamar({ token: a.token, metodo: 'POST', path: '/mcp' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('adversário — host absoluto é recusado: isto não é um SSRF', async () => {
    // O guardião mais importante e o mais barato. Se a tool aceitasse URL, o
    // modelo alcançaria metadados de nuvem e rede interna.
    const a = await registrar('request-ssrf@example.com');

    await expect(
      gatewayDeRequest.chamar({
        token: a.token,
        metodo: 'GET',
        path: 'http://169.254.169.254/latest/meta-data/',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('adversário — path com ".." é recusado', async () => {
    const a = await registrar('request-dotdot@example.com');

    await expect(
      gatewayDeRequest.chamar({ token: a.token, metodo: 'GET', path: '/api/v1/habits/../../mcp' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('adversário — a lista não permite nenhuma rota de auth', async () => {
    // Criar conta, autenticar e trocar e-mail são identidade, não hábito.
    const deAuth = ROTAS_PERMITIDAS.filter((r) => r.padrao.includes('/auth/'));
    expect(deAuth).toEqual([]);
  });

  it('toda rota da lista responde algo que NÃO é 404 — a lista não apodrece', async () => {
    // Se uma entrada apontar para rota que deixou de existir, ela vira permissão
    // morta e ninguém nota. Este caso é o que mantém a lista honesta.
    const a = await registrar('request-viva@example.com');
    const habitId = await criarHabito(a.token, 'Sonda');

    for (const rota of ROTAS_PERMITIDAS) {
      const path = rota.padrao
        .replace(':habitId', habitId)
        .replace(':id', habitId)
        .replace('/checkins/' + habitId, '/checkins/' + habitId);

      // Só os GET são exercitados: os de escrita alterariam estado, e o objetivo
      // aqui é provar que a rota EXISTE, não o que ela faz.
      if (rota.metodo !== 'GET') continue;

      const resposta = await gatewayDeRequest.chamar({
        token: a.token,
        metodo: rota.metodo,
        path,
      });
      expect(resposta.status).not.toBe(404);
    }
  });
});

describe('INV-04 — check-in em data futura é recusado', () => {
  it('adversário — data de amanhã responde 400', async () => {
    // Sem o teto, 365 inserts retroativos criam um ano de aderência que nunca
    // aconteceu, e cada um é individualmente válido. Com escrita manual isso é
    // erro de digitação; com um assistente compondo chamadas, é falsificação.
    const a = await registrar('futuro@example.com');
    const habitId = await criarHabito(a.token, 'Futuro');

    const resposta = await request(app)
      .post(`/api/v1/habits/${habitId}/checkin`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ date: `${toDayKey(addUtcDays(utcStartOfDay(), 1))}T10:00:00.000Z` });

    expect(resposta.status).toBe(400);
  });

  it('hoje e passado continuam aceitos', async () => {
    const a = await registrar('passado@example.com');
    const habitId = await criarHabito(a.token, 'Passado');

    const hoje = await request(app)
      .post(`/api/v1/habits/${habitId}/checkin`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ date: `${toDayKey(utcStartOfDay())}T23:00:00.000Z` });
    const ontem = await request(app)
      .post(`/api/v1/habits/${habitId}/checkin`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ date: `${toDayKey(addUtcDays(utcStartOfDay(), -1))}T10:00:00.000Z` });

    expect(hoje.status).toBe(201);
    expect(ontem.status).toBe(201);
  });
});

describe('createdVia — o histórico declara quem o produziu', () => {
  it('check-in pela API nasce como "user"', async () => {
    const a = await registrar('via-user@example.com');
    const habitId = await criarHabito(a.token, 'Origem');
    const checkinId = (
      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({})
    ).body.data.id as string;

    const linha = await prismaCru.checkin.findUnique({ where: { id: checkinId } });
    expect(linha!.createdVia).toBe('user');
  });

  it('adversário — createdVia no corpo da requisição é IGNORADO', async () => {
    // A origem vem de quem chama no servidor. Se viesse do corpo, o assistente
    // poderia declarar-se `user` e o histórico perderia a única marca que os
    // distingue — é INV-10 aplicado à origem do registro.
    const a = await registrar('via-forjado@example.com');
    const habitId = await criarHabito(a.token, 'Forjado');

    const criado = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Diz que é do usuário', createdVia: 'assistant' });

    const linha = await prismaCru.habit.findUnique({ where: { id: criado.body.data.id } });
    expect(linha!.createdVia).toBe('user');
    void habitId;
  });
});

describe('a extensão de soft delete impede delete físico', () => {
  it('adversário — habit.delete lança em vez de apagar', async () => {
    await expect(prisma.habit.delete({ where: { id: 'qualquer' } })).rejects.toThrow(
      /delete FÍSICO e não é permitido/
    );
  });

  it('adversário — checkin.deleteMany também lança', async () => {
    await expect(prisma.checkin.deleteMany({ where: { habitId: 'qualquer' } })).rejects.toThrow(
      /delete FÍSICO e não é permitido/
    );
  });

  it('limite conhecido — include de relação NÃO é filtrado', async () => {
    // A extensão intercepta a operação de topo; relação resolvida por `include`
    // não dispara a extensão para o modelo relacionado. Hoje não há um único
    // `include:` nos repositories, então o furo está fechado por ausência de uso
    // — e este caso existe para documentar o limite em vez de deixá-lo implícito.
    const a = await registrar('include-limite@example.com');
    const habitId = await criarHabito(a.token, 'Com include');
    const checkinId = (
      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({})
    ).body.data.id as string;

    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${checkinId}`)
      .set('Authorization', `Bearer ${a.token}`);

    const comInclude = await prisma.habit.findFirst({
      where: { id: habitId },
      include: { checkins: true },
    });

    // O check-in apagado APARECE. É o limite, e está declarado.
    expect(comInclude!.checkins.map((c) => c.id)).toContain(checkinId);
  });
});

describe('INV-25 — as primitivas pelo endpoint real, não pelos gateways', () => {
  /**
   * Os casos acima exercitam os gateways diretamente, e por isso não podem ver a
   * fiação: um `registrarPrimitivas` que nunca fosse chamado em `server.ts` os
   * deixaria todos verdes. Aqui a chamada entra por `POST /mcp`, atravessa o
   * `authenticate`, o servidor MCP e o transporte — é o caminho que o Claude Code
   * percorre.
   */
  const ACEITA = 'application/json, text/event-stream';
  let sequencia = 0;

  function chamada(method: string, params?: unknown) {
    return { jsonrpc: '2.0', id: ++sequencia, method, ...(params ? { params } : {}) };
  }

  async function sessao(token: string) {
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', ACEITA)
      .send(
        chamada('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'teste-primitivas', version: '0' },
        })
      );

    return (method: string, params?: unknown) =>
      request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', ACEITA)
        .send(chamada(method, params));
  }

  function texto(resposta: { body: { result?: { content?: { text: string }[] } } }) {
    return JSON.parse(resposta.body.result!.content![0]!.text);
  }

  it('INV-25: `request` cria um hábito de verdade e ele aparece na API', async () => {
    // O ciclo completo do conceito: o cliente compõe a chamada, a rota valida, o
    // banco grava, e a leitura confirma. Nada disto passa por tool escrita à mão.
    const a = await registrar('e2e-cria@example.com');
    const rpc = await sessao(a.token);

    const criado = texto(
      await rpc('tools/call', {
        name: 'request',
        arguments: {
          metodo: 'POST',
          path: '/api/v1/habits',
          corpo: { title: 'Nascido pelo MCP', scheduledDays: [1, 3] },
        },
      })
    );

    expect(criado.status).toBe(201);

    const lista = await request(app)
      .get('/api/v1/habits')
      .set('Authorization', `Bearer ${a.token}`);
    expect(lista.body.data.map((h: { title: string }) => h.title)).toContain('Nascido pelo MCP');
  });

  it('INV-25: adversário — rota fora da allowlist volta como erro da tool, não como sucesso', async () => {
    const a = await registrar('e2e-negada@example.com');
    const rpc = await sessao(a.token);

    const resposta = await rpc('tools/call', {
      name: 'request',
      arguments: { metodo: 'PUT', path: '/api/v1/auth/profile', corpo: { email: 'x@y.z' } },
    });

    // O SDK do MCP transforma exceção da tool em `isError`, não em 500 do
    // transporte. O que importa é não ser sucesso silencioso.
    expect(resposta.body.result?.isError ?? resposta.body.error !== undefined).toBe(true);
  });

  it('INV-25: adversário — o delete do hábito pelo MCP é LÓGICO, e a linha continua no banco', async () => {
    // A propriedade que o Matheus pediu: escrita livre, mas irreversibilidade não.
    const a = await registrar('e2e-delete@example.com');
    const habitId = await criarHabito(a.token, 'Vai ser apagado');
    const rpc = await sessao(a.token);

    const apagado = texto(
      await rpc('tools/call', {
        name: 'request',
        arguments: { metodo: 'DELETE', path: `/api/v1/habits/${habitId}` },
      })
    );
    expect(apagado.status).toBe(204);

    const cru = await prismaCru.habit.findUnique({ where: { id: habitId } });
    expect(cru).not.toBeNull();
    expect(cru!.deletedAt).toBeInstanceOf(Date);

    // E volta pelo mesmo caminho.
    const restaurado = texto(
      await rpc('tools/call', {
        name: 'request',
        arguments: { metodo: 'POST', path: `/api/v1/habits/${habitId}/restore` },
      })
    );
    expect(restaurado.status).toBe(200);
  });

  it('INV-25: `query` responde pelo endpoint, e só com os dados de quem chamou', async () => {
    const a = await registrar('e2e-query@example.com');
    const b = await registrar('e2e-query-outro@example.com');
    await criarHabito(a.token, 'De A');
    await criarHabito(b.token, 'De B');
    const rpc = await sessao(a.token);

    const resultado = texto(
      await rpc('tools/call', {
        name: 'query',
        arguments: { sql: 'SELECT title FROM habits WHERE "deletedAt" IS NULL' },
      })
    );

    expect(resultado.linhas.map((l: { title: string }) => l.title)).toEqual(['De A']);
  });

  it('INV-25: os recursos de descoberta chegam ao cliente e descrevem o sistema real', async () => {
    const a = await registrar('e2e-recursos@example.com');
    const rpc = await sessao(a.token);

    const uris = (await rpc('resources/list')).body.result.resources.map(
      (r: { uri: string }) => r.uri
    );
    expect(uris.sort()).toEqual([
      'habits://contratos',
      'habits://openapi',
      'habits://rotas',
      'habits://schema',
    ]);

    // O schema vem do catálogo do Postgres: as colunas do soft delete têm de
    // aparecer sem ninguém as ter escrito num arquivo de documentação.
    const schema = JSON.parse(
      (await rpc('resources/read', { uri: 'habits://schema' })).body.result.contents[0].text
    ) as { table_name: string; column_name: string }[];
    const colunas = schema.map((c) => `${c.table_name}.${c.column_name}`);
    expect(colunas).toContain('habits.deletedAt');
    expect(colunas).toContain('checkins.deleteBatchId');
    expect(colunas).toContain('checkins.createdVia');

    // E o contrato vem dos schemas Zod: `scheduledDays` é exigência de
    // `createHabitSchema`, não de uma tabela escrita à mão.
    const contratos = JSON.parse(
      (await rpc('resources/read', { uri: 'habits://contratos' })).body.result.contents[0].text
    ) as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(contratos['POST /api/v1/habits']!.properties ?? {})).toEqual(
      expect.arrayContaining(['title', 'scheduledDays'])
    );
  });

  it('INV-28: adversário — o hábito criado pelo MCP registra createdVia, e não o que o corpo disser', async () => {
    // A proveniência é do servidor. Se o corpo pudesse ditá-la, o registro de
    // "quem criou isto" viraria campo que o próprio autor preenche.
    const a = await registrar('e2e-proveniencia@example.com');
    const rpc = await sessao(a.token);

    const criado = texto(
      await rpc('tools/call', {
        name: 'request',
        arguments: {
          metodo: 'POST',
          path: '/api/v1/habits',
          corpo: { title: 'Proveniência', scheduledDays: [], createdVia: 'MANUAL' },
        },
      })
    );

    const cru = await prismaCru.habit.findFirst({ where: { id: criado.corpo.data.id } });
    // `assistant`, porque a primitiva marca a origem em toda chamada. E o
    // `createdVia: MANUAL` que o corpo pedia foi descartado pelo schema Zod, que
    // não conhece esse campo — a proveniência não é negociável pelo cliente.
    expect(cru!.createdVia).toBe('assistant');
  });
});

describe('INV-28 — a proveniência distingue os dois caminhos', () => {
  it('INV-28: hábito criado pelo caminho normal fica marcado como `user`', async () => {
    // O outro lado do caso acima, e o que torna a coluna útil: se TODO registro
    // virasse `assistant`, a distinção não existiria — do mesmo jeito que não
    // existia quando todo registro era `user`. São os dois casos juntos que
    // provam que a coluna separa alguma coisa.
    const a = await registrar('proveniencia-humana@example.com');
    const habitId = await criarHabito(a.token, 'Digitado pela pessoa');

    const cru = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(cru!.createdVia).toBe('user');
  });

  it('INV-28: check-in pelo MCP fica marcado como `assistant`', async () => {
    const a = await registrar('proveniencia-checkin@example.com');
    const habitId = await criarHabito(a.token, 'Com check-in do assistente');

    const gateway = new HttpRequestGateway();
    const resposta = await gateway.chamar({
      token: a.token,
      metodo: 'POST',
      path: `/api/v1/habits/${habitId}/checkin`,
    });
    expect(resposta.status).toBe(201);

    const checkin = await prismaCru.checkin.findFirst({ where: { habitId } });
    expect(checkin!.createdVia).toBe('assistant');
  });
});

describe('INV-29 — toda tabela do banco está classificada', () => {
  /**
   * O par de INV-26, aplicado ao banco.
   *
   * A primeira migração deu `pg_read_all_data` à role somente-leitura: leitura
   * global e opt-out, escopo por tabela e opt-in. A tabela que abriria o buraco
   * já está nomeada em `docs/PRIMITIVAS.md` como trabalho seguinte — o log de
   * execução da IA, com prompts e custos de todos os usuários. Ela nasceria
   * legível por inteiro pela primitiva, e nada falharia.
   *
   * Estes casos rodam na Camada 2 porque a pergunta é do banco: quem tem grant,
   * quem tem política. Nenhum arquivo do repositório responde isso.
   */
  async function tabelasDoBanco(): Promise<string[]> {
    const linhas = await prismaCru.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    return linhas.map((l) => l.tablename);
  }

  it('INV-29: o enumerador acha as tabelas — se não achar, nada abaixo prova nada', async () => {
    // O caso vizinho do próprio gate, outra vez. Uma consulta que devolvesse
    // lista vazia deixaria os casos seguintes verdes examinando nada.
    const tabelas = await tabelasDoBanco();

    expect(tabelas).toEqual(expect.arrayContaining(['users', 'habits', 'checkins']));
    expect(tabelas.length).toBeGreaterThanOrEqual(4);
  });

  it('INV-29: adversário — nenhuma tabela existe sem estar classificada', async () => {
    const classificadas = new Set<string>([
      ...TABELAS_EXPOSTAS,
      ...TABELAS_NAO_EXPOSTAS.map((t) => t.tabela),
    ]);

    const orfas = (await tabelasDoBanco()).filter((t) => !classificadas.has(t));

    // A mensagem carrega o nome porque quem quebrar isto precisa saber o que
    // classificar, e em qual das duas listas.
    expect(orfas).toEqual([]);
  });

  it('INV-29: adversário — tabela criada agora reprova o gate, sem estar em lista nenhuma', async () => {
    // O caso vizinho de verdade: não o que motivou o gate, e sim o que ele
    // deveria pegar. Sem isto, o caso acima passa por construção — todas as
    // tabelas de hoje estão nas listas, então ele nunca viu o gate acusar nada.
    await prismaCru.$executeRawUnsafe('CREATE TABLE "tabela_intrusa" (id text PRIMARY KEY)');

    try {
      const classificadas = new Set<string>([
        ...TABELAS_EXPOSTAS,
        ...TABELAS_NAO_EXPOSTAS.map((t) => t.tabela),
      ]);
      const orfas = (await tabelasDoBanco()).filter((t) => !classificadas.has(t));

      expect(orfas).toEqual(['tabela_intrusa']);
    } finally {
      await prismaCru.$executeRawUnsafe('DROP TABLE "tabela_intrusa"');
    }
  });

  it('INV-29: adversário — tabela nova NÃO nasce legível pela role somente-leitura', async () => {
    // A propriedade que a migração do grant explícito criou, e a razão de INV-29
    // existir. Com `pg_read_all_data` este caso falharia: a role veria a tabela
    // nova inteira, sem política, no instante em que ela fosse criada.
    await prismaCru.$executeRawUnsafe('CREATE TABLE "tabela_nova" (id text PRIMARY KEY)');
    await prismaCru.$executeRawUnsafe(`INSERT INTO "tabela_nova" VALUES ('segredo')`);

    try {
      const a = await registrar('inv29-grant@example.com');

      await expect(
        gatewayDeQuery!.executar(a.userId, 'SELECT id FROM "tabela_nova"')
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await prismaCru.$executeRawUnsafe('DROP TABLE "tabela_nova"');
    }
  });

  it('INV-29: toda tabela exposta tem grant de SELECT E política de RLS', async () => {
    // Estar na lista não basta: as duas coisas têm de existir no banco. Uma
    // tabela com grant e sem política seria legível por inteiro; com política e
    // sem grant, nem consultável — e o sintoma do segundo é `permission denied`
    // numa consulta legítima, que se lê como bug da consulta.
    for (const tabela of TABELAS_EXPOSTAS) {
      const [{ tem_grant }] = await prismaCru.$queryRawUnsafe<{ tem_grant: boolean }[]>(
        `SELECT has_table_privilege('habits_readonly', 'public.${tabela}', 'SELECT') AS tem_grant`
      );
      expect(tem_grant).toBe(true);

      const politicas = await prismaCru.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies
          WHERE schemaname = 'public' AND tablename = '${tabela}'
            AND 'habits_readonly' = ANY(roles)`
      );
      expect(politicas.length).toBeGreaterThanOrEqual(1);

      const [{ relrowsecurity }] = await prismaCru.$queryRawUnsafe<
        { relrowsecurity: boolean }[]
      >(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${tabela}'::regclass`);
      expect(relrowsecurity).toBe(true);
    }
  });

  it('INV-29: adversário — nenhuma tabela NÃO exposta tem grant para a role', async () => {
    // O outro lado. Uma entrada na lista de não-expostas com grant no banco é
    // uma mentira documentada, e é pior que a ausência da entrada.
    for (const { tabela } of TABELAS_NAO_EXPOSTAS) {
      const [{ tem_grant }] = await prismaCru.$queryRawUnsafe<{ tem_grant: boolean }[]>(
        `SELECT has_table_privilege('habits_readonly', 'public.${tabela}', 'SELECT') AS tem_grant`
      );
      expect(tem_grant).toBe(false);
    }
  });
});

describe('INV-31 — a edição pelo assistente é reversível e rastreada', () => {
  it('INV-31: `request` edita, o histórico guarda o anterior, e volta pelo mesmo caminho', async () => {
    // O ciclo que fecha a promessa do Objetivo pela superfície do assistente: ele
    // edita, e a pessoa consegue desfazer sem ter guardado nada por conta própria.
    const a = await registrar('e2e-historico@example.com');
    const habitId = await criarHabito(a.token, 'Titulo original');
    const gateway = new HttpRequestGateway();

    const editado = await gateway.chamar({
      token: a.token,
      metodo: 'PUT',
      path: `/api/v1/habits/${habitId}`,
      corpo: { title: 'Titulo do assistente' },
    });
    expect(editado.status).toBe(200);

    const historico = await gateway.chamar({
      token: a.token,
      metodo: 'GET',
      path: `/api/v1/habits/${habitId}/revisions`,
    });
    const versoes = (historico.corpo as { data: { id: string; title: string; changedVia: string }[] })
      .data;

    expect(versoes).toHaveLength(1);
    expect(versoes[0]!.title).toBe('Titulo original');
    // INV-28: a marca de que foi o assistente que editou, não a pessoa.
    expect(versoes[0]!.changedVia).toBe('assistant');

    const voltou = await gateway.chamar({
      token: a.token,
      metodo: 'POST',
      path: `/api/v1/habits/${habitId}/revisions/${versoes[0]!.id}/restore`,
    });
    expect(voltou.status).toBe(200);
    expect((voltou.corpo as { data: { title: string } }).data.title).toBe('Titulo original');
  });

  it('INV-31: `query` alcança o histórico, e só o das próprias revisões', async () => {
    // `habit_revisions` é exposta a `query` de propósito — histórico de edição é
    // exatamente o que se quer perguntar em linguagem natural. A política a escopa
    // pelo dono do HÁBITO, porque a revisão não tem `userId` próprio: duplicá-lo
    // abriria a chance de divergir do dono.
    const a = await registrar('e2e-query-hist-a@example.com');
    const b = await registrar('e2e-query-hist-b@example.com');
    const meu = await criarHabito(a.token, 'Hábito de A');
    const dele = await criarHabito(b.token, 'Hábito de B');

    for (const [token, id, titulo] of [
      [a.token, meu, 'A editado'],
      [b.token, dele, 'B editado'],
    ] as const) {
      await request(app)
        .put(`/api/v1/habits/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: titulo });
    }

    const resultado = await gatewayDeQuery!.executar(
      a.userId,
      'SELECT title FROM habit_revisions ORDER BY title'
    );

    expect(resultado.linhas.map((l) => (l as { title: string }).title)).toEqual(['Hábito de A']);
  });

  it('INV-25: `destructiveHint` da tool chegou a false pelo caminho derivado', async () => {
    // Contra o endpoint real, não contra a constante: é o que um cliente MCP vê, e
    // é a evidência de que a migração do histórico mudou a anotação sem ninguém
    // ter editado `primitivas.ts`.
    const a = await registrar('e2e-hint@example.com');
    const rpc = await (async () => {
      await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${a.token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 900,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'hint', version: '0' },
          },
        });
      return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${a.token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 901, method: 'tools/list', params: {} });
    })();

    const requestTool = (
      rpc.body.result.tools as { name: string; annotations: { destructiveHint: boolean } }[]
    ).find((t) => t.name === 'request')!;

    expect(requestTool.annotations.destructiveHint).toBe(false);
  });
});

describe('INV-33 — o socket obsoleto do pool não pode colidir', () => {
  /**
   * A causa mais provável do flake `read ECONNRESET`, verificada de forma
   * DETERMINÍSTICA em vez de por reprodução.
   *
   * `fetch` no Node é undici, e o `globalDispatcher` mantém sockets keep-alive por
   * origem no escopo do processo. A primitiva `request` faz `fetch` real contra o
   * servidor em porta efêmera que este arquivo levanta — e `servidor.close()` não
   * fecha esses sockets. Eles ficam no pool apontando para uma porta morta, e o SO
   * recicla portas efêmeras: quando uma cai numa que o undici ainda tem em pool, o
   * socket morto e o listener novo se cruzam e quem espera resposta recebe RST.
   *
   * Medido: **2 `TCPSocketWrap` sobrevivem ao `servidor.close()` em toda
   * execução** — determinístico, ao contrário do flake.
   *
   * O que isto NÃO prova é que a reciclagem de porta causou o flake observado: o
   * kernel roteia por 4-tuple, então um RST do cliente obsoleto chega no servidor
   * obsoleto e não no listener novo. Fecha uma classe compatível com o sintoma.
   *
   * `--detectOpenHandles` não pega: o undici gerencia os sockets em pool interno e
   * o Jest não os atribui a teste nenhum.
   */
  it('INV-33: a porta do servidor de teste está FORA da faixa efêmera', () => {
    // A propriedade inteira em uma asserção. Se alguém trocar por `listen(0)` ou
    // por um número dentro da faixa, o flake volta — e este caso é o que impede,
    // porque o sintoma é raro e aparece num arquivo sem relação com a causa —
    // condições em que ninguém liga a falha a esta linha.
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;

    expect(porta).toBe(PORTA_FIXA_DE_TESTE);
    // 32768 é o piso do Linux (o do CI); o macOS começa em 49152. Abaixo do menor
    // dos dois vale nos dois.
    expect(porta).toBeLessThan(MENOR_PORTA_EFEMERA_CONHECIDA);
  });

  it('INV-33: adversário — GET se recupera de socket obsoleto do pool', async () => {
    // O risco que a porta fixa introduziu, e que o peer apontou: origem estável é
    // precisamente a condição para o undici REUSAR o socket do pool. Fechar o
    // servidor e reabrir na mesma porta deixa o pool com um socket morto.
    //
    // Este caso FALHAVA com `read ECONNRESET` antes do retry — determinístico
    // dentro do Jest, e curiosamente não em Node puro, onde o undici se recupera
    // sozinho. Comportamento que muda com o runtime é o que não se deve deixar
    // como pressuposto, e foi o que motivou consertar no gateway em vez de evitar
    // no teste.
    const { token } = await registrar('porta-reaberta@example.com');

    await gatewayDeRequest.chamar({ token, metodo: 'GET', path: '/api/v1/habits' });

    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      servidor = app
        .listen(PORTA_FIXA_DE_TESTE, () => resolve())
        .on('error', (erro: Error) => reject(erro));
    });

    const depois = await gatewayDeRequest.chamar({
      token,
      metodo: 'GET',
      path: '/api/v1/habits',
    });

    expect(depois.status).toBe(200);
  });

  it('INV-33: adversário — ESCRITA não é repetida em silêncio', async () => {
    // A metade que importa mais. `ECONNRESET` não diz se a requisição chegou ao
    // servidor — então repetir um POST poderia criar dois registros, e o problema
    // não é o efeito de cada rota, é **não saber** se a primeira foi aplicada.
    //
    // Escrita falha alto e a decisão de tentar de novo é da pessoa, que é a mesma
    // fronteira do resto do desenho. Este caso é o que impede alguém "melhorar" o
    // retry estendendo-o a todo método.
    const { token } = await registrar('escrita-sem-retry@example.com');
    const habitId = await criarHabito(token, 'Nao deve duplicar');

    await gatewayDeRequest.chamar({ token, metodo: 'GET', path: '/api/v1/habits' });
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      servidor = app
        .listen(PORTA_FIXA_DE_TESTE, () => resolve())
        .on('error', (erro: Error) => reject(erro));
    });

    // A primeira escrita depois da reabertura pega o socket obsoleto. Ela pode
    // falhar ou passar, dependendo de o undici já ter descartado o socket — o que
    // este caso fixa é que ela NUNCA é repetida automaticamente, então o
    // check-in não pode nascer duplicado.
    await gatewayDeRequest
      .chamar({ token, metodo: 'POST', path: `/api/v1/habits/${habitId}/checkin` })
      .catch(() => undefined);

    const checkins = await prismaCru.checkin.findMany({ where: { habitId } });
    expect(checkins.length).toBeLessThanOrEqual(1);
  });

  it('INV-33: adversário — o socket do pool REALMENTE sobrevive ao close, e é por isso que a porta importa', async () => {
    // Mede a premissa em vez de afirmá-la em comentário. Se um dia o Node passar
    // a fechar os sockets do pool junto com o servidor, este caso reprova e a
    // porta fixa deixa de ser necessária — o que é informação, não falha.
    const { token } = await registrar('pool-sobrevive@example.com');
    await gatewayDeRequest.chamar({ token, metodo: 'GET', path: '/api/v1/habits' });

    const auxiliar = app.listen(0);
    await new Promise<void>((resolve) => auxiliar.once('listening', () => resolve()));
    const antes = recursosAtivos().TCPSocketWrap ?? 0;
    await new Promise<void>((resolve) => auxiliar.close(() => resolve()));
    const depois = recursosAtivos().TCPSocketWrap ?? 0;

    // Fechar um servidor não reduz os sockets keep-alive do pool: eles não são
    // dele. É a premissa do desenho, e agora está medida.
    expect(antes).toBeGreaterThan(0);
    expect(depois).toBeGreaterThanOrEqual(antes - 1);
  });
});
