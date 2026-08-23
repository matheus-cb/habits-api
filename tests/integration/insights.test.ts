import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@/config/database';
import { addUtcDays, toDayKey, utcStartOfDay, utcWeekday } from '@/utils/helpers';
import { aguardarFechamentos } from '@/mcp/fechamentos';

/**
 * Camada 2 — bate no app inteiro contra PostgreSQL real.
 *
 * O que só se prova aqui: a constraint única do banco (INV-01), o 401 de rota
 * protegida, e que o endpoint de insights responde íntegro **sem**
 * `ANTHROPIC_API_KEY` — o ambiente de teste não tem chave, então toda esta
 * suíte roda no caminho determinístico por construção (INV-15).
 */

const HOJE = utcStartOfDay();

/** Data ISO de N dias atrás, em UTC. */
function diasAtras(n: number): string {
  return `${toDayKey(addUtcDays(HOJE, -n))}T00:00:00.000Z`;
}

/** Offsets, dentro dos últimos 30 dias, que caem no dia da semana pedido. */
function offsetsDoDia(weekday: number): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset < 30; offset++) {
    if (utcWeekday(addUtcDays(HOJE, -offset)) === weekday) offsets.push(offset);
  }
  return offsets;
}

async function registrar(email = 'insights@example.com') {
  const resposta = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Insights', email, password: 'password123' });
  return resposta.body.data.accessToken as string;
}

async function criarHabito(token: string, scheduledDays: number[], title = 'Correr') {
  const resposta = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays });
  return resposta.body.data.id as string;
}

/**
 * Recua o `createdAt` do hábito.
 *
 * A janela de aderência nunca começa antes da criação do hábito (INV-06), e um
 * hábito criado pela API nasce agora — então sem envelhecer, toda janela tem um
 * dia e nenhum destes testes diz o que pretende dizer. A API não expõe (nem deve
 * expor) uma forma de datar hábito no passado; o teste escreve direto no banco,
 * que é o único lugar onde isso é aceitável.
 */
async function envelhecerHabito(habitId: string, dias: number) {
  await prisma.habit.update({
    where: { id: habitId },
    data: { createdAt: addUtcDays(HOJE, -dias) },
  });
}

async function marcar(token: string, habitId: string, offset: number) {
  return request(app)
    .post(`/api/v1/habits/${habitId}/checkin`)
    .set('Authorization', `Bearer ${token}`)
    .send({ date: diasAtras(offset) });
}

describe('INV-01 — a constraint do banco é a garantia de um check-in por dia', () => {
  it('INV-01: o mesmo dia enviado em horas diferentes é uma só linha, e a segunda responde 409', async () => {
    // A prova de que `@db.Date` + `@@unique` fazem o trabalho: os dois pedidos
    // trazem instantes diferentes do MESMO dia UTC.
    const token = await registrar();
    const habitId = await criarHabito(token, []);
    const dia = toDayKey(addUtcDays(HOJE, -3));

    const primeira = await request(app)
      .post(`/api/v1/habits/${habitId}/checkin`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: `${dia}T01:00:00.000Z` });
    const segunda = await request(app)
      .post(`/api/v1/habits/${habitId}/checkin`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: `${dia}T22:00:00.000Z` });

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(409);

    const lista = await request(app)
      .get(`/api/v1/habits/${habitId}/checkins`)
      .set('Authorization', `Bearer ${token}`);
    expect(lista.body.data).toHaveLength(1);
  });

  it('INV-01: adversário — dois pedidos simultâneos do mesmo dia produzem um 201 e um 409, nunca 500', async () => {
    // Aqui a consulta prévia do service não protege: os dois passam por ela ao
    // mesmo tempo e um perde na constraint. O que se verifica é que o perdedor
    // recebe 409, e não 500 por erro de banco cru.
    const token = await registrar('corrida@example.com');
    const habitId = await criarHabito(token, []);

    const respostas = await Promise.all([marcar(token, habitId, 5), marcar(token, habitId, 5)]);
    const status = respostas.map((r) => r.status).sort();

    expect(status).toEqual([201, 409]);
    expect(status).not.toContain(500);
  });
});

describe('INV-06 — a aderência do endpoint respeita os dias agendados', () => {
  it('INV-06: hábito de 3x por semana cumprido à risca responde 100%', async () => {
    // Este é o caso que a invariante existe para garantir: com o denominador
    // antigo (30 fixo), cumprir tudo dava ~43% e parecia negligência.
    const token = await registrar('adesao@example.com');
    const habitId = await criarHabito(token, [1, 3, 5]);
    await envelhecerHabito(habitId, 60);
    const offsets = [...offsetsDoDia(1), ...offsetsDoDia(3), ...offsetsDoDia(5)];
    for (const offset of offsets) await marcar(token, habitId, offset);

    const resposta = await request(app)
      .get(`/api/v1/habits/${habitId}/stats`)
      .set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.data.completionRate).toBe(100);
    expect(resposta.body.data.extraCheckins).toBe(0);
  });
});

describe('INV-15 — a camada de insights responde sem provedor de IA configurado', () => {
  it('INV-15: /insights/adherence responde 200 com source deterministic', async () => {
    // O ambiente de teste não define ANTHROPIC_API_KEY. Se este caso passasse a
    // exigir chave, a suíte quebraria — e é exatamente o que se quer que ela faça.
    const token = await registrar('semia@example.com');
    const habitId = await criarHabito(token, [1, 3, 5]);
    for (const offset of offsetsDoDia(1)) await marcar(token, habitId, offset);

    const resposta = await request(app)
      .get('/api/v1/insights/adherence')
      .set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.data.narration.source).toBe('deterministic');
    expect(resposta.body.data.narration.fallbackReason).toBe('AI_NOT_CONFIGURED');
    expect(typeof resposta.body.data.narration.summary).toBe('string');
    expect(resposta.body.data.report.habitCount).toBe(1);
  });

  it('INV-16: a resposta não carrega chave, prompt nem raciocínio do modelo', async () => {
    const token = await registrar('vazamento@example.com');
    await criarHabito(token, [1]);

    const resposta = await request(app)
      .get('/api/v1/insights/adherence')
      .set('Authorization', `Bearer ${token}`);
    const corpo = JSON.stringify(resposta.body);

    expect(corpo).not.toMatch(/sk-ant/);
    expect(corpo).not.toMatch(/Você redige/i);
    expect(corpo).not.toMatch(/thinking/i);
  });

  it('INV-10: adversário — /insights/adherence sem token responde 401', async () => {
    const resposta = await request(app).get('/api/v1/insights/adherence');
    expect(resposta.status).toBe(401);
  });
});

describe('INV-18/INV-19 — reagendamento só se aplica pelo confirm', () => {
  /**
   * Hábito de segunda e sexta, com todas as segundas cumpridas e nenhuma sexta.
   *
   * Envelhecido em 60 dias para a janela ter as quatro ou cinco sextas que o
   * motor exige como sinal — sem isso a janela tem um dia e não há proposta
   * nenhuma, o que é o comportamento correto e inútil para este teste.
   */
  async function habitoComSextaFalhando(token: string) {
    const habitId = await criarHabito(token, [1, 5], 'Academia');
    await envelhecerHabito(habitId, 60);
    for (const offset of offsetsDoDia(1)) await marcar(token, habitId, offset);
    return habitId;
  }

  it('INV-18: a proposta chega com token assinado e NÃO altera o hábito', async () => {
    const token = await registrar('proposta@example.com');
    const habitId = await habitoComSextaFalhando(token);

    const propostas = await request(app)
      .get('/api/v1/insights/reschedule-proposals')
      .set('Authorization', `Bearer ${token}`);

    expect(propostas.status).toBe(200);
    const proposta = (propostas.body.data as { habitId: string; token: string }[]).find(
      (item) => item.habitId === habitId
    );
    expect(proposta?.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // O hábito segue exatamente como estava: propor não é aplicar.
    const habito = await request(app)
      .get(`/api/v1/habits/${habitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(habito.body.data.scheduledDays).toEqual([1, 5]);
  });

  it('INV-18: confirmar aplica os dias propostos', async () => {
    const token = await registrar('confirma@example.com');
    const habitId = await habitoComSextaFalhando(token);

    const propostas = await request(app)
      .get('/api/v1/insights/reschedule-proposals')
      .set('Authorization', `Bearer ${token}`);
    const proposta = (
      propostas.body.data as { habitId: string; token: string; proposedScheduledDays: number[] }[]
    ).find((item) => item.habitId === habitId)!;

    const confirmado = await request(app)
      .post('/api/v1/insights/reschedule-proposals/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: proposta.token });

    expect(confirmado.status).toBe(200);
    expect(confirmado.body.data.scheduledDays).toEqual(proposta.proposedScheduledDays);
  });

  it('INV-18: adversário — token adulterado é recusado e nada é gravado', async () => {
    const token = await registrar('adultera@example.com');
    const habitId = await habitoComSextaFalhando(token);

    const propostas = await request(app)
      .get('/api/v1/insights/reschedule-proposals')
      .set('Authorization', `Bearer ${token}`);
    const proposta = (propostas.body.data as { habitId: string; token: string }[]).find(
      (item) => item.habitId === habitId
    )!;

    const [payload, assinatura] = proposta.token.split('.');
    const decodificado = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
    decodificado.proposedScheduledDays = [0, 1, 2, 3, 4, 5, 6];
    const adulterado = `${Buffer.from(JSON.stringify(decodificado)).toString('base64url')}.${assinatura}`;

    const resposta = await request(app)
      .post('/api/v1/insights/reschedule-proposals/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: adulterado });

    expect(resposta.status).toBe(400);

    const habito = await request(app)
      .get(`/api/v1/habits/${habitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(habito.body.data.scheduledDays).toEqual([1, 5]);
  });

  it('INV-19: adversário — a proposta de uma pessoa não é aplicável por outra', async () => {
    const vitima = await registrar('vitima@example.com');
    const habitId = await habitoComSextaFalhando(vitima);
    const atacante = await registrar('atacante@example.com');

    const propostas = await request(app)
      .get('/api/v1/insights/reschedule-proposals')
      .set('Authorization', `Bearer ${vitima}`);
    const proposta = (propostas.body.data as { habitId: string; token: string }[]).find(
      (item) => item.habitId === habitId
    )!;

    const resposta = await request(app)
      .post('/api/v1/insights/reschedule-proposals/confirm')
      .set('Authorization', `Bearer ${atacante}`)
      .send({ token: proposta.token });

    expect(resposta.status).toBe(403);

    const habito = await request(app)
      .get(`/api/v1/habits/${habitId}`)
      .set('Authorization', `Bearer ${vitima}`);
    expect(habito.body.data.scheduledDays).toEqual([1, 5]);
  });

  it('INV-18: adversário — confirm sem token no corpo responde 400', async () => {
    const token = await registrar('semtoken@example.com');

    const resposta = await request(app)
      .post('/api/v1/insights/reschedule-proposals/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(resposta.status).toBe(400);
  });
});

describe('INV-17 — o endpoint MCP é somente leitura e autenticado', () => {
  function chamada(metodo: string, params: unknown = {}) {
    return { jsonrpc: '2.0', id: 1, method: metodo, params };
  }

  const ACEITA = 'application/json, text/event-stream';

  it('INV-10: adversário — /mcp sem token responde 401', async () => {
    const resposta = await request(app)
      .post('/mcp')
      .set('Accept', ACEITA)
      .send(chamada('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'teste', version: '0' },
      }));

    expect(resposta.status).toBe(401);
  });

  it('INV-17/INV-25: o endpoint anuncia as tools de leitura mais as duas primitivas', async () => {
    const token = await registrar('mcp@example.com');

    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', ACEITA)
      .send(
        chamada('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'teste', version: '0' },
        })
      );

    const resposta = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', ACEITA)
      .send(chamada('tools/list'));

    expect(resposta.status).toBe(200);
    const tools = (resposta.body.result?.tools ?? []) as {
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }[];

    // A lista literal fica: é o que um assistente externo REALMENTE vê, e uma
    // tool acrescentada sem alguém decidir tem de quebrar aqui. `query` está aqui
    // porque a suíte de integração roda com `DATABASE_URL_READONLY` configurada —
    // é a mesma conexão que os testes das primitivas usam.
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_adherence_report',
      'get_habit',
      'get_habit_stats',
      'list_checkins',
      'list_habits',
      'query',
      'request',
    ]);

    // E a propriedade que a mudança de desenho torna crítica: exatamente UMA
    // escreve. Enquanto tudo era leitura, isto era grátis; agora é a fronteira.
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual([
      'request',
    ]);
  });

  it('INV-17: GET em /mcp responde 405 — o transporte não tem sessão', async () => {
    const token = await registrar('mcpget@example.com');

    const resposta = await request(app).get('/mcp').set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(405);
  });
});

// Mesmo motivo do `primitivas-mcp.test.ts`: este arquivo também bate em `/mcp`, e
// os fechamentos disparados aqui completariam no meio do próximo.
afterAll(async () => {
  await aguardarFechamentos();
});
