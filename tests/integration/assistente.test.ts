import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { app } from '@/app';
import { AssistantService, EventoDoAssistente } from '@/assistant/assistant.service';
import { criarGatewayDeQuery } from '@/mcp/query';
import { HttpRequestGateway } from '@/mcp/request';
import { registrarEnderecoLocal, esquecerEnderecoLocal } from '@/mcp/endereco';
import { PORTA_FIXA_DE_TESTE, erroDePortaOcupada } from '../lib/porta-fixa';

/**
 * O assistente conversacional — Camada 2.
 *
 * ## Por que um cliente DUBLADO e não a API de verdade
 *
 * Duas razões, e a segunda é a que decide. A primeira é custo: exercitar o laço
 * de verdade gasta dinheiro a cada execução da suíte. A segunda é que o teste
 * precisa controlar **o que o modelo decide** — a fronteira que importa é "o
 * modelo pediu para escrever e nada foi escrito", e provar isso exige encenar o
 * pedido. Com a API real, o modelo poderia simplesmente não pedir.
 *
 * O que o dublê NÃO cobre: se o prompt produz boas decisões. Isso não é
 * verificável por teste automático, e está declarado como tal.
 */
const prismaCru = new PrismaClient();
const gatewayDeQuery = criarGatewayDeQuery();

let servidor: ReturnType<typeof app.listen>;
let gatewayDeRequest: HttpRequestGateway;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    servidor = app
      .listen(PORTA_FIXA_DE_TESTE, () => resolve())
      .on('error', (erro: NodeJS.ErrnoException) => {
        reject(erro.code === 'EADDRINUSE' ? new Error(erroDePortaOcupada(PORTA_FIXA_DE_TESTE)) : erro);
      });
  });
  registrarEnderecoLocal(servidor);
  gatewayDeRequest = new HttpRequestGateway();
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
    .send({ name: 'Chat', email, password: 'password123' });
  return { token: r.body.data.accessToken as string, userId: r.body.data.user.id as string };
}

async function criarHabito(token: string, title: string, scheduledDays: number[] = [1, 3, 5]) {
  const r = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays });
  return r.body.data.id as string;
}

/**
 * Um cliente da Anthropic que devolve respostas encenadas, em ordem.
 *
 * `usage` vai preenchido porque o registro de `ai_calls` e o teto diário leem
 * dele — um dublê com `usage` zerado faria o orçamento parecer funcionar sem
 * nunca contar nada.
 */
function clienteFalso(respostas: Partial<Anthropic.Message>[]) {
  const chamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;

  const create = jest.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    chamadas.push(params);
    const resposta = respostas[Math.min(i, respostas.length - 1)]!;
    i += 1;
    return {
      id: `msg_${i}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [],
      ...resposta,
    } as Anthropic.Message;
  });

  return { cliente: { messages: { create } } as unknown as Anthropic, chamadas, create };
}

function texto(conteudo: string): Partial<Anthropic.Message> {
  return { content: [{ type: 'text', text: conteudo, citations: null }] };
}

function usoDeFerramenta(nome: string, input: unknown, id = 'tool_1'): Partial<Anthropic.Message> {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: nome, input }],
  };
}

function coletar() {
  const eventos: EventoDoAssistente[] = [];
  return { eventos, emitir: (e: EventoDoAssistente) => eventos.push(e) };
}

describe('INV-34 — leitura executa, escrita PARA e vira proposta', () => {
  it('INV-34: o assistente consulta e responde sem escrever nada', async () => {
    const a = await registrar('chat-consulta@example.com');
    await criarHabito(a.token, 'Correr de manha');

    const { cliente } = clienteFalso([
      usoDeFerramenta('consultar', {
        sql: 'SELECT title FROM habits WHERE "deletedAt" IS NULL',
        motivo: 'listar os hábitos ativos',
      }),
      texto('Você tem 1 hábito ativo: Correr de manha.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'quais são meus hábitos?');
    const { eventos, emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'quais são meus hábitos?',
      emitir,
    });

    expect(eventos.map((e) => e.tipo)).toEqual([
      'ferramenta',
      'resultado',
      'texto',
      'fim',
    ]);
    expect(eventos.at(-1)).toEqual({ tipo: 'fim', motivo: 'completo' });
    // Nada pendente: leitura não propõe.
    expect(await prismaCru.pendingAction.count({ where: { conversationId: conversa.id } })).toBe(0);
  });

  it('INV-34: adversário — o modelo pede escrita e NADA é escrito', async () => {
    // O caso central. O modelo pede `DELETE`, e o hábito continua lá — a proposta
    // é uma linha em `pending_actions`, não uma chamada.
    const a = await registrar('chat-escrita-para@example.com');
    const habitId = await criarHabito(a.token, 'Nao deve ser apagado');

    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'DELETE',
        path: `/api/v1/habits/${habitId}`,
        resumo: 'Apaga o hábito "Nao deve ser apagado".',
      }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'apaga esse hábito');
    const { eventos, emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'apaga esse hábito',
      emitir,
    });

    expect(eventos.at(-1)).toEqual({ tipo: 'fim', motivo: 'aguardando_aprovacao' });

    const acao = await prismaCru.pendingAction.findFirst({ where: { conversationId: conversa.id } });
    expect(acao!.status).toBe('pending');
    expect(acao!.metodo).toBe('DELETE');

    // E o hábito continua ativo — nada aconteceu.
    const habito = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(habito!.deletedAt).toBeNull();
  });

  it('INV-34: aprovar executa, e marca a origem como assistant', async () => {
    const a = await registrar('chat-aprova@example.com');
    const habitId = await criarHabito(a.token, 'Vai ser editado');

    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'PUT',
        path: `/api/v1/habits/${habitId}`,
        corpo: { title: 'Editado pelo assistente' },
        resumo: 'Renomeia o hábito.',
      }),
      texto('Pronto, renomeei.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'renomeia');
    const { emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'renomeia',
      emitir,
    });

    const acao = await prismaCru.pendingAction.findFirst({ where: { conversationId: conversa.id } });
    const decisao = await service.decidir({
      userId: a.userId,
      token: a.token,
      actionId: acao!.id,
      aprovar: true,
    });

    expect(decisao.status).toBe('approved');

    const habito = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(habito!.title).toBe('Editado pelo assistente');

    // INV-28 pela superfície do chat: a edição fica marcada como do assistente.
    const revisao = await prismaCru.habitRevision.findFirst({ where: { habitId } });
    expect(revisao!.changedVia).toBe('assistant');
  });

  it('INV-34: recusar NÃO executa, e o histórico registra a recusa', async () => {
    // Recusar tem de deixar rastro no histórico. Sem isso, o modelo na volta
    // seguinte não sabe que foi recusado e propõe de novo — e a pessoa recusa a
    // mesma coisa para sempre.
    const a = await registrar('chat-recusa@example.com');
    const habitId = await criarHabito(a.token, 'Intocado');

    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'DELETE',
        path: `/api/v1/habits/${habitId}`,
        resumo: 'Apaga o hábito.',
      }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'apaga');
    const { emitir } = coletar();
    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'apaga',
      emitir,
    });

    const acao = await prismaCru.pendingAction.findFirst({ where: { conversationId: conversa.id } });
    const decisao = await service.decidir({
      userId: a.userId,
      token: a.token,
      actionId: acao!.id,
      aprovar: false,
    });

    expect(decisao.status).toBe('rejected');
    const habito = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(habito!.deletedAt).toBeNull();

    const mensagens = await prismaCru.conversationMessage.findMany({
      where: { conversationId: conversa.id },
      orderBy: { ordem: 'asc' },
    });
    expect(mensagens.at(-1)!.content).toContain('recusou');
  });
});

describe('INV-34 — os guardiões do assistente', () => {
  it('INV-34: adversário — rota fora da allowlist é recusada na PROPOSTA', async () => {
    const a = await registrar('chat-rota-negada@example.com');
    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'PUT',
        path: '/api/v1/auth/profile',
        corpo: { email: 'outro@example.com' },
        resumo: 'Troca seu e-mail.',
      }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'troca meu email');
    const { emitir } = coletar();

    await expect(
      service.responder({
        userId: a.userId,
        token: a.token,
        conversationId: conversa.id,
        mensagem: 'troca meu email',
        emitir,
      })
    ).rejects.toThrow(/não está no alcance/);

    expect(await prismaCru.pendingAction.count({ where: { conversationId: conversa.id } })).toBe(0);
  });

  it('INV-34: adversário — o assistente não pode chamar a si mesmo', async () => {
    // Recursão. Sem esta negação, uma conversa abriria outra conversa, que
    // proporia ações, que abririam outra — custo sem teto, e cada nível parece
    // legítimo para os dois limites que existem.
    const a = await registrar('chat-recursao@example.com');
    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'POST',
        path: '/api/v1/assistant/messages',
        corpo: { mensagem: 'e agora?' },
        resumo: 'Continua a conversa.',
      }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'te pergunta algo');
    const { emitir } = coletar();

    await expect(
      service.responder({
        userId: a.userId,
        token: a.token,
        conversationId: conversa.id,
        mensagem: 'te pergunta algo',
        emitir,
      })
    ).rejects.toThrow(/não está no alcance/);
  });

  it('INV-34: adversário — consulta de dado alheio devolve vazio, não erro', async () => {
    // A RLS agindo pela superfície do chat. O modelo pode escrever a pior consulta
    // possível; ela executa e não vê nada de outra pessoa.
    const a = await registrar('chat-rls-a@example.com');
    const b = await registrar('chat-rls-b@example.com');
    await criarHabito(b.token, 'Hábito de B');

    const { cliente } = clienteFalso([
      usoDeFerramenta('consultar', {
        sql: 'SELECT title FROM habits',
        motivo: 'listar tudo',
      }),
      texto('Você não tem hábitos.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'lista tudo');
    const { eventos, emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'lista tudo',
      emitir,
    });

    const resultado = eventos.find((e) => e.tipo === 'resultado');
    expect(resultado).toEqual({ tipo: 'resultado', nome: 'consultar', linhas: 0 });
  });

  it('INV-34: adversário — escrita pelo `consultar` falha, e o modelo é avisado', async () => {
    // O modelo pode tentar escrever pela ferramenta de leitura. Falha no banco, e
    // o resultado volta com `is_error` para ele corrigir em vez de tratar a
    // mensagem de erro como dado.
    const a = await registrar('chat-sql-escrita@example.com');
    const { cliente, chamadas } = clienteFalso([
      usoDeFerramenta('consultar', {
        sql: "UPDATE habits SET title = 'invadido'",
        motivo: 'tentar escrever',
      }),
      texto('Não consegui.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'muda tudo');
    const { eventos, emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'muda tudo',
      emitir,
    });

    expect(eventos.find((e) => e.tipo === 'resultado')).toMatchObject({ erro: expect.any(String) });
    // A volta seguinte recebeu o erro marcado como erro.
    const ultimaChamada = chamadas.at(-1)!;
    expect(JSON.stringify(ultimaChamada.messages)).toContain('is_error');
  });

  it('INV-34: o teto de voltas encerra a mensagem e AVISA', async () => {
    // Um modelo que nunca para de pedir ferramenta. O teto garante que a mensagem
    // termina, e o aviso garante que a pessoa saiba — parar em silêncio seria
    // indistinguível de resposta completa.
    const a = await registrar('chat-teto-voltas@example.com');
    const { cliente, create } = clienteFalso([
      usoDeFerramenta('consultar', { sql: 'SELECT 1 AS x', motivo: 'girando' }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'gira');
    const { eventos, emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'gira',
      emitir,
    });

    expect(eventos.at(-1)).toEqual({ tipo: 'fim', motivo: 'teto_de_voltas' });
    expect(create).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(eventos)).toContain('Parei aqui');
  });

  it('INV-35: toda chamada ao modelo é registrada, com tokens e duração', async () => {
    const a = await registrar('chat-registro@example.com');
    const { cliente } = clienteFalso([
      usoDeFerramenta('consultar', { sql: 'SELECT 1 AS x', motivo: 'olhando' }),
      texto('Pronto.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'oi');
    const { emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'oi',
      emitir,
    });

    const chamadas = await prismaCru.aiCall.findMany({ where: { userId: a.userId } });
    // Duas voltas: a que pediu ferramenta e a que respondeu.
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.outputTokens).toBe(50);
    expect(chamadas[0]!.toolCalls).toBe(1);
    expect(chamadas[1]!.toolCalls).toBe(0);
    expect(chamadas[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('INV-35: adversário — o registro NÃO guarda prompt nem texto do modelo', async () => {
    // INV-16 aplicado ao registro. Auditoria de custo não precisa do conteúdo, e
    // guardar conteúdo transformaria a tabela de custo em cópia da conversa —
    // com outra política de retenção e outro alcance.
    const a = await registrar('chat-registro-limpo@example.com');
    const { cliente } = clienteFalso([texto('um segredo qualquer que nao deve aparecer')]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'frase da pessoa');
    const { emitir } = coletar();

    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'frase da pessoa',
      emitir,
    });

    const chamada = await prismaCru.aiCall.findFirst({ where: { userId: a.userId } });
    const serializada = JSON.stringify(chamada);

    expect(serializada).not.toContain('segredo');
    expect(serializada).not.toContain('frase da pessoa');
  });

  it('INV-36: teto diário excedido recusa antes de chamar o modelo', async () => {
    // Recusa ANTES da chamada. Recusar depois cobraria a chamada que excedeu, o
    // que faz o teto ser "o teto mais uma mensagem" — o mesmo motivo do `>=`.
    const a = await registrar('chat-teto-diario@example.com');
    await prismaCru.aiCall.create({
      data: {
        userId: a.userId,
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 999_999,
        durationMs: 1,
        outcome: 'end_turn',
      },
    });

    const { cliente, create } = clienteFalso([texto('nao deveria chegar aqui')]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'oi');
    const { emitir } = coletar();

    await expect(
      service.responder({
        userId: a.userId,
        token: a.token,
        conversationId: conversa.id,
        mensagem: 'oi',
        emitir,
      })
    ).rejects.toThrow(/Teto diário/);

    expect(create).not.toHaveBeenCalled();
  });

  it('INV-03: adversário — conversa de outra pessoa é recusada', async () => {
    const a = await registrar('chat-dono-a@example.com');
    const b = await registrar('chat-dono-b@example.com');
    const { cliente } = clienteFalso([texto('oi')]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const daA = await service.abrirConversa(a.userId, undefined, 'minha conversa');

    await expect(service.abrirConversa(b.userId, daA.id, 'invadindo')).rejects.toThrow(
      /não é sua/
    );
  });

  it('INV-03: adversário — aprovar ação de outra pessoa é recusado', async () => {
    const a = await registrar('chat-acao-dono-a@example.com');
    const b = await registrar('chat-acao-dono-b@example.com');
    const habitId = await criarHabito(a.token, 'Da pessoa A');

    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'DELETE',
        path: `/api/v1/habits/${habitId}`,
        resumo: 'Apaga.',
      }),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'apaga');
    const { emitir } = coletar();
    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'apaga',
      emitir,
    });

    const acao = await prismaCru.pendingAction.findFirst({ where: { conversationId: conversa.id } });

    await expect(
      service.decidir({ userId: b.userId, token: b.token, actionId: acao!.id, aprovar: true })
    ).rejects.toThrow(/não é sua/);

    const habito = await prismaCru.habit.findFirst({ where: { id: habitId } });
    expect(habito!.deletedAt).toBeNull();
  });

  it('INV-34: adversário — a mesma ação não é aprovada duas vezes', async () => {
    // Sem isto, um duplo clique na interface criaria dois check-ins, ou dois
    // deletes. O estado da ação é o que impede, e ele é conferido no servidor.
    const a = await registrar('chat-duas-aprovacoes@example.com');
    const habitId = await criarHabito(a.token, 'Uma vez so');

    const { cliente } = clienteFalso([
      usoDeFerramenta('agir', {
        metodo: 'POST',
        path: `/api/v1/habits/${habitId}/checkin`,
        resumo: 'Marca o check-in de hoje.',
      }),
      texto('Marquei.'),
    ]);
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, cliente);
    const conversa = await service.abrirConversa(a.userId, undefined, 'marca hoje');
    const { emitir } = coletar();
    await service.responder({
      userId: a.userId,
      token: a.token,
      conversationId: conversa.id,
      mensagem: 'marca hoje',
      emitir,
    });

    const acao = await prismaCru.pendingAction.findFirst({ where: { conversationId: conversa.id } });
    await service.decidir({ userId: a.userId, token: a.token, actionId: acao!.id, aprovar: true });

    await expect(
      service.decidir({ userId: a.userId, token: a.token, actionId: acao!.id, aprovar: true })
    ).rejects.toThrow(/já foi/);

    expect(await prismaCru.checkin.count({ where: { habitId } })).toBe(1);
  });
});

describe('INV-15 — sem chave, o chat recusa e o app segue', () => {
  it('INV-15: o serviço se declara indisponível sem cliente', () => {
    const service = new AssistantService(gatewayDeQuery, gatewayDeRequest, null);
    const disponibilidade = service.disponivel();

    expect(disponibilidade.ok).toBe(false);
    expect(disponibilidade.motivo).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('INV-15: `/assistant/status` diz por que está indisponível', async () => {
    // A rota real. Ela responde 200 com `disponivel: false` em vez de erro: a
    // interface precisa da razão para mostrar instruções, e um 503 sem corpo
    // legível a deixaria sem o que dizer.
    const a = await registrar('chat-status@example.com');
    const resposta = await request(app)
      .get('/api/v1/assistant/status')
      .set('Authorization', `Bearer ${a.token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.data.disponivel).toBe(false);
    expect(resposta.body.data.motivo).toMatch(/ANTHROPIC_API_KEY/);
    expect(resposta.body.data.orcamento.teto).toBeGreaterThan(0);
  });

  it('INV-15: o resto do app não muda sem chave', async () => {
    const a = await registrar('chat-app-intacto@example.com');
    await criarHabito(a.token, 'Funciona sem IA');

    const habitos = await request(app)
      .get('/api/v1/habits')
      .set('Authorization', `Bearer ${a.token}`);
    const insights = await request(app)
      .get('/api/v1/insights/adherence')
      .set('Authorization', `Bearer ${a.token}`);

    expect(habitos.status).toBe(200);
    expect(insights.status).toBe(200);
    expect(insights.body.data.narration.source).toBe('deterministic');
  });
});
