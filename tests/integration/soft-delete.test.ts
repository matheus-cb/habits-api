import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@/config/database';
import { PrismaClient } from '@prisma/client';
import { addUtcDays, toDayKey, utcStartOfDay } from '@/utils/helpers';

/**
 * Soft delete — Camada 2.
 *
 * Só o banco real prova o que importa aqui: que o índice único **parcial**
 * permite remarcar um check-in no mesmo dia depois de desfazê-lo, e que a
 * extensão do Prisma esconde o apagado de **toda** consulta em vez de dos doze
 * lugares onde alguém lembrou de filtrar.
 *
 * `prismaCru` é um client SEM a extensão: é o único jeito de olhar a linha
 * apagada e provar que ela continua no banco, em vez de confiar que "sumiu".
 */
const prismaCru = new PrismaClient();

afterAll(async () => {
  await prismaCru.$disconnect();
});

const HOJE = utcStartOfDay();

async function registrar(email: string) {
  const r = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Soft', email, password: 'password123' });
  return r.body.data.accessToken as string;
}

async function criarHabito(token: string, title = 'Correr') {
  const r = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays: [] });
  return r.body.data.id as string;
}

function marcar(token: string, habitId: string, offset: number) {
  return request(app)
    .post(`/api/v1/habits/${habitId}/checkin`)
    .set('Authorization', `Bearer ${token}`)
    .send({ date: `${toDayKey(addUtcDays(HOJE, -offset))}T10:00:00.000Z` });
}

describe('INV-01 — a unicidade vale entre os check-ins ATIVOS', () => {
  it('INV-01: marcar, desfazer e marcar de novo no mesmo dia funciona', async () => {
    // O fluxo mais comum do app, e o que o índice único ANTIGO quebrava: ele
    // cobria a tabela inteira, então a segunda marcação colidia com uma linha
    // que o usuário não vê mais. O índice parcial estreita para os ativos.
    const token = await registrar('remarca@example.com');
    const habitId = await criarHabito(token);

    const primeira = await marcar(token, habitId, 2);
    expect(primeira.status).toBe(201);
    const checkinId = primeira.body.data.id as string;

    const desfeito = await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${checkinId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(desfeito.status).toBe(204);

    const segunda = await marcar(token, habitId, 2);
    expect(segunda.status).toBe(201);
    expect(segunda.body.data.id).not.toBe(checkinId);
  });

  it('INV-01: duas marcações ATIVAS no mesmo dia continuam sendo 409', async () => {
    // O estreitamento não afrouxou a regra: entre ativos, a duplicata segue
    // impossível, e é o índice que impede — não a consulta prévia do service.
    const token = await registrar('duplicata-ativa@example.com');
    const habitId = await criarHabito(token);

    expect((await marcar(token, habitId, 3)).status).toBe(201);
    expect((await marcar(token, habitId, 3)).status).toBe(409);
  });

  it('INV-01: adversário — dois pedidos simultâneos ainda dão 201 e 409', async () => {
    const token = await registrar('corrida-parcial@example.com');
    const habitId = await criarHabito(token);

    const status = (await Promise.all([marcar(token, habitId, 4), marcar(token, habitId, 4)]))
      .map((r) => r.status)
      .sort();

    expect(status).toEqual([201, 409]);
  });
});

describe('soft delete — o registro sai da vista e permanece no banco', () => {
  it('desfazer check-in marca deletedAt em vez de apagar a linha', async () => {
    const token = await registrar('permanece@example.com');
    const habitId = await criarHabito(token);
    const checkinId = (await marcar(token, habitId, 5)).body.data.id as string;

    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${checkinId}`)
      .set('Authorization', `Bearer ${token}`);

    // Invisível pela API…
    const lista = await request(app)
      .get(`/api/v1/habits/${habitId}/checkins`)
      .set('Authorization', `Bearer ${token}`);
    expect(lista.body.data).toHaveLength(0);

    // …e presente no banco, com o timestamp. É isto que torna reversível.
    const cru = await prismaCru.checkin.findUnique({ where: { id: checkinId } });
    expect(cru).not.toBeNull();
    expect(cru!.deletedAt).toBeInstanceOf(Date);
  });

  it('restaurar o check-in devolve ele à listagem', async () => {
    const token = await registrar('restaura-checkin@example.com');
    const habitId = await criarHabito(token);
    const checkinId = (await marcar(token, habitId, 6)).body.data.id as string;

    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${checkinId}`)
      .set('Authorization', `Bearer ${token}`);
    const restaurado = await request(app)
      .post(`/api/v1/habits/${habitId}/checkins/${checkinId}/restore`)
      .set('Authorization', `Bearer ${token}`);

    expect(restaurado.status).toBe(200);
    const lista = await request(app)
      .get(`/api/v1/habits/${habitId}/checkins`)
      .set('Authorization', `Bearer ${token}`);
    expect(lista.body.data.map((c: { id: string }) => c.id)).toContain(checkinId);
  });

  it('apagar hábito esconde ele e os check-ins dele, com o MESMO timestamp', async () => {
    // O timestamp compartilhado é o marcador do lote: é ele que faz o restore
    // devolver só o que este delete apagou, sem ressuscitar o que já estava
    // apagado antes.
    const token = await registrar('lote@example.com');
    const habitId = await criarHabito(token);
    const antigo = (await marcar(token, habitId, 8)).body.data.id as string;
    await marcar(token, habitId, 9);

    // Este é desfeito ANTES, então não pertence ao lote do delete do hábito.
    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${antigo}`)
      .set('Authorization', `Bearer ${token}`);

    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${token}`);

    const habitos = await request(app).get('/api/v1/habits').set('Authorization', `Bearer ${token}`);
    expect(habitos.body.data).toHaveLength(0);

    const linhas = await prismaCru.checkin.findMany({ where: { habitId } });
    const timestamps = [...new Set(linhas.map((c) => c.deletedAt?.toISOString()))];
    expect(linhas).toHaveLength(2);
    expect(timestamps).toHaveLength(2); // o desfeito antes tem timestamp próprio
  });

  it('restaurar o hábito devolve só os check-ins do lote dele', async () => {
    const token = await registrar('lote-restore@example.com');
    const habitId = await criarHabito(token);
    const desfeitoAntes = (await marcar(token, habitId, 11)).body.data.id as string;
    const doLote = (await marcar(token, habitId, 12)).body.data.id as string;

    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${desfeitoAntes}`)
      .set('Authorization', `Bearer ${token}`);
    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`/api/v1/habits/${habitId}/restore`)
      .set('Authorization', `Bearer ${token}`);

    const lista = await request(app)
      .get(`/api/v1/habits/${habitId}/checkins`)
      .set('Authorization', `Bearer ${token}`);
    const ids = lista.body.data.map((c: { id: string }) => c.id);

    expect(ids).toContain(doLote);
    expect(ids).not.toContain(desfeitoAntes);
  });

  it('adversário — hábito apagado responde 404, não 403 nem 200', async () => {
    const token = await registrar('apagado-404@example.com');
    const habitId = await criarHabito(token);
    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${token}`);

    const lido = await request(app)
      .get(`/api/v1/habits/${habitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(lido.status).toBe(404);
  });

  it('adversário — check-in em hábito apagado responde 404', async () => {
    const token = await registrar('checkin-apagado@example.com');
    const habitId = await criarHabito(token);
    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${token}`);

    expect((await marcar(token, habitId, 1)).status).toBe(404);
  });

  it('INV-06: a aderência ignora check-in apagado', async () => {
    // Se o cálculo contasse o apagado, desfazer um check-in não mudaria a taxa —
    // e a pessoa veria um número que não corresponde ao que ela vê na tela.
    const token = await registrar('aderencia-apagada@example.com');
    const habitId = await criarHabito(token);
    await prismaCru.habit.update({
      where: { id: habitId },
      data: { createdAt: addUtcDays(HOJE, -60) },
    });
    const c1 = (await marcar(token, habitId, 1)).body.data.id as string;
    await marcar(token, habitId, 2);

    const antes = await request(app)
      .get(`/api/v1/habits/${habitId}/stats`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .delete(`/api/v1/habits/${habitId}/checkins/${c1}`)
      .set('Authorization', `Bearer ${token}`);
    const depois = await request(app)
      .get(`/api/v1/habits/${habitId}/stats`)
      .set('Authorization', `Bearer ${token}`);

    expect(antes.body.data.completedInWindow).toBe(2);
    expect(depois.body.data.completedInWindow).toBe(1);
    expect(depois.body.data.totalCheckins).toBe(1);
  });
});

describe('a extensão recusa findUnique em vez de converter em silêncio', () => {
  it('adversário — habit.findUnique lança com mensagem que ensina o caminho', async () => {
    // Conversão silenciosa para `findFirst` funcionaria e esconderia a diferença.
    // Falhar alto é a escolha: obriga quem escrever a próxima consulta a usar
    // `findFirst`, que é filtrado, em vez de descobrir meses depois que uma
    // consulta via apagado.
    await expect(prisma.habit.findUnique({ where: { id: 'qualquer' } })).rejects.toThrow(
      /findUnique não é permitido/
    );
  });

  it('adversário — checkin.findUnique também lança', async () => {
    await expect(prisma.checkin.findUnique({ where: { id: 'qualquer' } })).rejects.toThrow(
      /findUnique não é permitido/
    );
  });

  it('user.findUnique continua funcionando — users não tem soft delete', async () => {
    // A extensão não intercepta `users`, e não deve: filtrar um modelo sem a
    // coluna quebraria toda consulta de autenticação.
    await expect(
      prisma.user.findUnique({ where: { email: 'inexistente@example.com' } })
    ).resolves.toBeNull();
  });

  it('adversário — o client CRU vê o apagado, provando que o filtro é da extensão', async () => {
    const token = await registrar('prova-extensao@example.com');
    const habitId = await criarHabito(token);
    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${token}`);

    // Filtrado pela extensão…
    await expect(prisma.habit.findFirst({ where: { id: habitId } })).resolves.toBeNull();
    // …e presente para quem não a tem.
    await expect(prismaCru.habit.findFirst({ where: { id: habitId } })).resolves.not.toBeNull();
  });
});
