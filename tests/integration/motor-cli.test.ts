import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '@/app';
import { AssistantService, EventoDoAssistente } from '@/assistant/assistant.service';
import { MotorCli } from '@/assistant/motor-cli';
import { criarGatewayDeQuery } from '@/mcp/query';
import { HttpRequestGateway } from '@/mcp/request';
import { esquecerEnderecoLocal, registrarEnderecoLocal } from '@/mcp/endereco';
import { CABECALHO_DE_CONVERSA, TOOLS_DO_ASSISTENTE } from '@/mcp/tools-assistente';
import { erroDePortaOcupada, PORTA_FIXA_DE_TESTE } from '../lib/porta-fixa';

/**
 * O motor do assistente sobre o CLI do Claude Code — Camada 2.
 *
 * ## O que estes testes NÃO fazem
 *
 * Não invocam o CLI de verdade. Cada invocação custa dinheiro da assinatura de
 * quem roda a suíte e leva de 11 a 28 segundos — medido. Uma suíte que gastasse
 * isso a cada execução seria abandonada, e suíte abandonada é pior que suíte
 * incompleta.
 *
 * O que eles provam é o que **não** depende do modelo: a superfície restrita não
 * tem tool de escrita, o `propor` grava e não executa, a conferência de dono, e o
 * ambiente do subprocesso. O fluxo completo com o CLI real foi verificado à mão e
 * está registrado em `docs/ASSISTENTE.md`.
 */
const prismaCru = new PrismaClient();
const gatewayDeQuery = criarGatewayDeQuery();

let servidor: ReturnType<typeof app.listen>;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    servidor = app
      .listen(PORTA_FIXA_DE_TESTE, () => resolve())
      .on('error', (erro: NodeJS.ErrnoException) => {
        reject(
          erro.code === 'EADDRINUSE' ? new Error(erroDePortaOcupada(PORTA_FIXA_DE_TESTE)) : erro
        );
      });
  });
  registrarEnderecoLocal(servidor);
});

afterAll(async () => {
  esquecerEnderecoLocal();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await gatewayDeQuery?.encerrar();
  await prismaCru.$disconnect();
});

async function registrar(email: string) {
  const r = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'CLI', email, password: 'password123' });
  return { token: r.body.data.accessToken as string, userId: r.body.data.user.id as string };
}

async function criarHabito(token: string, title: string) {
  const r = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays: [1, 3, 5] });
  return r.body.data.id as string;
}

const ACEITA = 'application/json, text/event-stream';
let sequencia = 0;

function chamadaMcp(token: string, conversationId: string, method: string, params?: unknown) {
  return request(app)
    .post('/mcp/assistente')
    .set('Authorization', `Bearer ${token}`)
    .set(CABECALHO_DE_CONVERSA, conversationId)
    .set('Accept', ACEITA)
    .send({ jsonrpc: '2.0', id: ++sequencia, method, ...(params ? { params } : {}) });
}

async function abrirSessaoMcp(token: string, conversationId: string) {
  await chamadaMcp(token, conversationId, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'teste-cli', version: '0' },
  });
}

describe('INV-38 — a superfície do assistente não TEM tool de escrita', () => {
  it('INV-38: `/mcp/assistente` anuncia exatamente `consultar` e `propor`', async () => {
    // A garantia é topológica: não há o que permitir ou negar. `--allowedTools` do
    // CLI **não restringe** — medido: com só `query` permitida, o modelo chamou
    // `request` e a chamada chegou ao servidor. Depender de `--disallowedTools`
    // faria tool nova nascer chamável, que é a classe de INV-26.
    const a = await registrar('cli-superficie@example.com');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    const resposta = await chamadaMcp(a.token, conversa.id, 'tools/list');

    expect(resposta.status).toBe(200);
    expect((resposta.body.result.tools as { name: string }[]).map((t) => t.name).sort()).toEqual(
      [...TOOLS_DO_ASSISTENTE].sort()
    );
  });

  it('INV-38: adversário — `request` e `agir` NÃO existem nesta superfície', async () => {
    const a = await registrar('cli-sem-escrita@example.com');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    for (const proibida of ['request', 'agir']) {
      const resposta = await chamadaMcp(a.token, conversa.id, 'tools/call', {
        name: proibida,
        arguments: { metodo: 'DELETE', path: '/api/v1/habits/x' },
      });

      const falhou =
        resposta.body.error !== undefined || resposta.body.result?.isError === true;
      expect(falhou).toBe(true);
    }
  });

  it('INV-38: adversário — sem o cabeçalho da conversa, a superfície recusa', async () => {
    // O `conversationId` vem do cabeçalho que o servidor põe no arquivo de
    // configuração, nunca de argumento da tool. Sem ele não há onde gravar a
    // proposta, e responder 400 é melhor que gravar numa conversa adivinhada.
    const a = await registrar('cli-sem-cabecalho@example.com');

    const resposta = await request(app)
      .post('/mcp/assistente')
      .set('Authorization', `Bearer ${a.token}`)
      .set('Accept', ACEITA)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(resposta.status).toBe(400);
    expect(JSON.stringify(resposta.body)).toContain(CABECALHO_DE_CONVERSA);
  });

  it('INV-38: a rota restrita ganha da completa por PRECEDÊNCIA', async () => {
    // `app.use('/mcp', …)` casa com qualquer caminho sob `/mcp`. Se a restrita
    // fosse montada depois, ela só seria alcançada por o router completo não ter
    // rota para `/assistente` — garantia por ausência, que uma rota nova lá dentro
    // apagaria. Este caso é o que fixa a ordem.
    const a = await registrar('cli-precedencia@example.com');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    const restrita = await chamadaMcp(a.token, conversa.id, 'tools/list');
    const nomes = (restrita.body.result.tools as { name: string }[]).map((t) => t.name);

    // Se a completa tivesse ganhado, `request` estaria aqui.
    expect(nomes).not.toContain('request');
    expect(nomes).toHaveLength(2);
  });
});

describe('INV-38 — `propor` grava e NÃO executa', () => {
  it('INV-38: propor um DELETE deixa o hábito intacto', async () => {
    const a = await registrar('cli-propor@example.com');
    const habitId = await criarHabito(a.token, 'Nao deve ser apagado');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    const resposta = await chamadaMcp(a.token, conversa.id, 'tools/call', {
      name: 'propor',
      arguments: {
        metodo: 'DELETE',
        path: `/api/v1/habits/${habitId}`,
        resumo: 'Apaga o hábito.',
      },
    });

    const conteudo = JSON.parse(resposta.body.result.content[0].text as string) as {
      proposta: string;
      estado: string;
    };
    expect(conteudo.estado).toContain('aguardando');

    const acao = await prismaCru.pendingAction.findFirst({ where: { id: conteudo.proposta } });
    expect(acao!.status).toBe('pending');

    // O que importa: nada aconteceu.
    const habito = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(habito!.deletedAt).toBeNull();
  });

  it('INV-38: adversário — propor rota FORA da allowlist é recusado', async () => {
    const a = await registrar('cli-propor-negada@example.com');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    const resposta = await chamadaMcp(a.token, conversa.id, 'tools/call', {
      name: 'propor',
      arguments: {
        metodo: 'PUT',
        path: '/api/v1/auth/profile',
        corpo: { email: 'outro@example.com' },
        resumo: 'Troca seu e-mail.',
      },
    });

    expect(resposta.body.result?.isError ?? resposta.body.error !== undefined).toBe(true);
    expect(await prismaCru.pendingAction.count({ where: { conversationId: conversa.id } })).toBe(0);
  });

  it('INV-38: adversário — propor numa conversa de OUTRA pessoa é recusado', async () => {
    // O cabeçalho vem do servidor, mas conferir o dono custa uma consulta e fecha
    // o caso de um arquivo de configuração vazado — ele carrega o JWT e o id da
    // conversa juntos.
    const a = await registrar('cli-dono-a@example.com');
    const b = await registrar('cli-dono-b@example.com');
    const conversaDeA = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'da pessoa A' },
    });

    await request(app)
      .post('/mcp/assistente')
      .set('Authorization', `Bearer ${b.token}`)
      .set(CABECALHO_DE_CONVERSA, conversaDeA.id)
      .set('Accept', ACEITA)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
      });

    const resposta = await request(app)
      .post('/mcp/assistente')
      .set('Authorization', `Bearer ${b.token}`)
      .set(CABECALHO_DE_CONVERSA, conversaDeA.id)
      .set('Accept', ACEITA)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'propor',
          arguments: { metodo: 'POST', path: '/api/v1/habits', resumo: 'invadindo' },
        },
      });

    expect(resposta.body.result?.isError ?? resposta.body.error !== undefined).toBe(true);
    expect(await prismaCru.pendingAction.count({ where: { conversationId: conversaDeA.id } })).toBe(
      0
    );
  });

  it('INV-38: `consultar` funciona e é escopado pela RLS', async () => {
    const a = await registrar('cli-consultar-a@example.com');
    const b = await registrar('cli-consultar-b@example.com');
    await criarHabito(a.token, 'De A');
    await criarHabito(b.token, 'De B');
    const conversa = await prismaCru.conversation.create({
      data: { userId: a.userId, title: 'teste' },
    });
    await abrirSessaoMcp(a.token, conversa.id);

    const resposta = await chamadaMcp(a.token, conversa.id, 'tools/call', {
      name: 'consultar',
      arguments: { sql: 'SELECT title FROM habits WHERE "deletedAt" IS NULL', motivo: 'listar' },
    });

    const conteudo = JSON.parse(resposta.body.result.content[0].text as string) as {
      linhas: { title: string }[];
    };
    expect(conteudo.linhas.map((l) => l.title)).toEqual(['De A']);
  });
});

describe('INV-38 — o subprocesso e o que ele leva', () => {
  it('INV-38: o motor recusa quando CLAUDE_CLI_PATH não aponta para nada', async () => {
    const motor = new MotorCli();
    const original = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = path.join(os.tmpdir(), 'nao-existe-claude');

    try {
      // `env` é lido na inicialização, então o motor consulta `cliDisponivel()`
      // que lê `env.CLAUDE_CLI_PATH` — congelado. Este caso confere a mensagem do
      // caminho ausente, que é a que a pessoa vai ver.
      const { cliDisponivel } = await import('@/assistant/motor-cli');
      const estado = cliDisponivel();

      // Sem CLI configurado no `.env.test`, a resposta é a de ausência.
      expect(estado.ok).toBe(false);
      expect(estado.motivo).toMatch(/CLAUDE_CLI_PATH/);
      expect(motor).toBeInstanceOf(MotorCli);
    } finally {
      process.env.CLAUDE_CLI_PATH = original;
    }
  });

  it('INV-38: adversário — a configuração MCP não fica no disco depois da chamada', async () => {
    // O arquivo carrega o JWT de quem conversa. Ele é apagado num `finally`, então
    // vale mesmo quando o parse estoura — se fosse depois do parse, um erro
    // deixaria o token no disco à espera de alguém.
    const antes = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('habits-mcp-')).length;

    const motor = new MotorCli();
    await motor
      .perguntar({
        token: 'token-de-teste',
        conversationId: 'conversa-de-teste',
        sessionId: null,
        mensagem: 'oi',
        sistema: 'teste',
      })
      .catch(() => undefined);

    const depois = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('habits-mcp-')).length;
    expect(depois).toBe(antes);
  });
});
