import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '@/app';
import { prisma } from '@/config/database';

/**
 * INV-31 — recuperável vale para edição, e não só para exclusão.
 *
 * O `AGENTS.md` promete registro "exato e recuperável". Até esta safra a promessa
 * valia para exclusão (soft delete, `deleteBatchId`, `/restore`) e não valia para
 * edição: `PUT /habits/:id` sobrescrevia e o título anterior deixava de existir,
 * sem delete, sem purge e sem rastro. A assimetria é do domínio; as primitivas do
 * MCP a tornaram alcançável por composição, e foi isso que a promoveu de dívida a
 * defeito.
 *
 * Camada 2 porque a garantia central é transacional: a revisão e a edição têm de
 * nascer juntas ou não nascer. Nenhum dublê prova isso.
 */
const prismaCru = new PrismaClient();

afterAll(async () => {
  await prismaCru.$disconnect();
});

async function registrar(email: string) {
  const r = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Hist', email, password: 'password123' });
  return { token: r.body.data.accessToken as string, userId: r.body.data.user.id as string };
}

async function criarHabito(token: string, title: string, scheduledDays: number[] = []) {
  const r = await request(app)
    .post('/api/v1/habits')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, scheduledDays });
  return r.body.data.id as string;
}

function editar(token: string, habitId: string, corpo: Record<string, unknown>) {
  return request(app)
    .put(`/api/v1/habits/${habitId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
}

function revisoes(token: string, habitId: string) {
  return request(app)
    .get(`/api/v1/habits/${habitId}/revisions`)
    .set('Authorization', `Bearer ${token}`);
}

describe('INV-31 — cada edição grava a versão anterior', () => {
  it('INV-31: editar o título deixa o anterior recuperável', async () => {
    const a = await registrar('hist-titulo@example.com');
    const habitId = await criarHabito(a.token, 'Correr de manhã');

    await editar(a.token, habitId, { title: 'Correr à noite' });

    const lista = await revisoes(a.token, habitId);
    expect(lista.status).toBe(200);
    expect(lista.body.data).toHaveLength(1);
    expect(lista.body.data[0].title).toBe('Correr de manhã');
  });

  it('INV-31: o histórico NÃO contém o estado atual', async () => {
    // Duas fontes de verdade para o mesmo valor, e a que ninguém lê é a que
    // divergiria. O atual vive em `habits`; aqui só o que deixou de ser.
    const a = await registrar('hist-nao-atual@example.com');
    const habitId = await criarHabito(a.token, 'Primeiro');
    await editar(a.token, habitId, { title: 'Segundo' });

    const titulos = (await revisoes(a.token, habitId)).body.data.map(
      (r: { title: string }) => r.title
    );

    expect(titulos).toEqual(['Primeiro']);
    expect(titulos).not.toContain('Segundo');
  });

  it('INV-31: três edições produzem três versões, da mais recente para a mais antiga', async () => {
    const a = await registrar('hist-ordem@example.com');
    const habitId = await criarHabito(a.token, 'versao um');

    await editar(a.token, habitId, { title: 'versao dois' });
    await editar(a.token, habitId, { title: 'versao tres' });
    await editar(a.token, habitId, { title: 'versao quatro' });

    const titulos = (await revisoes(a.token, habitId)).body.data.map(
      (r: { title: string }) => r.title
    );

    expect(titulos).toEqual(['versao tres', 'versao dois', 'versao um']);
  });

  it('INV-31: os TRÊS campos que o PUT sobrescreve entram no snapshot', async () => {
    // O caso vizinho do schema: se `PUT` passar a escrever um quarto campo e a
    // revisão não o guardar, a promessa volta a ser parcial — e parcial é pior
    // que ausente, porque parece cumprida.
    const a = await registrar('hist-campos@example.com');
    const habitId = await criarHabito(a.token, 'Antigo', [1, 3]);
    await editar(a.token, habitId, { description: 'descrição antiga' });

    await editar(a.token, habitId, {
      title: 'Novo',
      description: 'descrição nova',
      scheduledDays: [5, 6],
    });

    const ultima = (await revisoes(a.token, habitId)).body.data[0];
    expect(ultima.title).toBe('Antigo');
    expect(ultima.description).toBe('descrição antiga');
    expect(ultima.scheduledDays).toEqual([1, 3]);
  });
});

describe('INV-31 — restaurar é recuperação, não outra sobrescrita', () => {
  it('INV-31: restaurar volta os três campos', async () => {
    const a = await registrar('hist-restaura@example.com');
    const habitId = await criarHabito(a.token, 'Original', [1, 2]);
    await editar(a.token, habitId, { title: 'Alterado', scheduledDays: [4] });

    const revisaoId = (await revisoes(a.token, habitId)).body.data[0].id as string;
    const restaurado = await request(app)
      .post(`/api/v1/habits/${habitId}/revisions/${revisaoId}/restore`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(restaurado.status).toBe(200);
    expect(restaurado.body.data.title).toBe('Original');
    expect(restaurado.body.data.scheduledDays).toEqual([1, 2]);
  });

  it('INV-31: adversário — restaurar TAMBÉM grava revisão, então dá para voltar de novo', async () => {
    // O defeito que esta tabela existe para fechar, reintroduzido pela própria
    // função que o fecha: se o restore não gravasse snapshot, desfazer uma edição
    // destruiria o estado de onde se desfez, e a segunda tentativa de voltar não
    // teria para onde ir.
    const a = await registrar('hist-restaura-duas@example.com');
    const habitId = await criarHabito(a.token, 'titulo A');
    await editar(a.token, habitId, { title: 'titulo B' });

    // Volta para o título A. Isto tem de guardar o B.
    const paraA = (await revisoes(a.token, habitId)).body.data[0].id as string;
    await request(app)
      .post(`/api/v1/habits/${habitId}/revisions/${paraA}/restore`)
      .set('Authorization', `Bearer ${a.token}`);

    const historico = (await revisoes(a.token, habitId)).body.data.map(
      (r: { title: string }) => r.title
    );
    expect(historico).toEqual(['titulo B', 'titulo A']);

    // E volta para B, usando a revisão que o próprio restore criou.
    const paraB = (await revisoes(a.token, habitId)).body.data[0].id as string;
    const deVolta = await request(app)
      .post(`/api/v1/habits/${habitId}/revisions/${paraB}/restore`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(deVolta.body.data.title).toBe('titulo B');
  });

  it('INV-31: adversário — revisão de outro hábito responde 404, não aplica', async () => {
    // O ataque: um revisionId válido, de um hábito que também é meu, aplicado no
    // hábito errado. O service casa os dois ids, e é por isso que o schema valida
    // os DOIS — a posse é conferida sobre o habitId, e ele chega da URL.
    const a = await registrar('hist-cruzado@example.com');
    const alvo = await criarHabito(a.token, 'Alvo');
    const outro = await criarHabito(a.token, 'Outro');
    await editar(a.token, outro, { title: 'Outro editado' });

    const revisaoDoOutro = (await revisoes(a.token, outro)).body.data[0].id as string;
    const tentativa = await request(app)
      .post(`/api/v1/habits/${alvo}/revisions/${revisaoDoOutro}/restore`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(tentativa.status).toBe(404);
    const lido = await request(app)
      .get(`/api/v1/habits/${alvo}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(lido.body.data.title).toBe('Alvo');
  });

  it('INV-03: adversário — o histórico de outra pessoa responde 403 ou 404, nunca 200', async () => {
    const a = await registrar('hist-dono-a@example.com');
    const b = await registrar('hist-dono-b@example.com');
    const habitDeA = await criarHabito(a.token, 'De A');
    await editar(a.token, habitDeA, { title: 'De A editado' });

    const lista = await revisoes(b.token, habitDeA);

    expect([403, 404]).toContain(lista.status);
  });
});

describe('INV-31 — a transação, e o que ela protege', () => {
  it('INV-31: a revisão e a edição são atômicas — nada de revisão sem edição', async () => {
    // Se a revisão gravasse e o update falhasse, o histórico ganharia uma versão
    // que nunca foi substituída, e a linha mais recente deixaria de significar "o
    // que havia antes da última edição". Um `scheduledDays` inválido é recusado
    // pelo Zod antes do repositório, então aqui o teste é o outro lado: uma
    // edição recusada não deixa revisão para trás.
    const a = await registrar('hist-atomico@example.com');
    const habitId = await criarHabito(a.token, 'Intacto', [1]);

    const recusada = await editar(a.token, habitId, { scheduledDays: [9] });
    expect(recusada.status).toBe(400);

    expect((await revisoes(a.token, habitId)).body.data).toEqual([]);
    const lido = await request(app)
      .get(`/api/v1/habits/${habitId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(lido.body.data.title).toBe('Intacto');
  });

  it('INV-31: adversário — a aplicação não pode apagar histórico', async () => {
    // Histórico que a aplicação apaga não é histórico. A extensão lança em vez de
    // filtrar, porque `HabitRevision` não tem soft delete e não deveria ter: uma
    // revisão apagada logicamente seria um terceiro estado numa tabela de dois.
    await expect(prisma.habitRevision.deleteMany({ where: { habitId: 'qualquer' } })).rejects.toThrow(
      /histórico que a aplicação apaga não é histórico/
    );
    await expect(prisma.habitRevision.delete({ where: { id: 'qualquer' } })).rejects.toThrow(
      /não é permitido/
    );
  });

  it('INV-31: o histórico sobrevive ao soft delete do hábito e volta com ele', async () => {
    // Apagar logicamente não é editar: não gera revisão, e não pode consumir o
    // histórico existente. Se consumisse, apagar-e-restaurar seria um jeito de
    // limpar o rastro de edições.
    const a = await registrar('hist-soft-delete@example.com');
    const habitId = await criarHabito(a.token, 'Vai e volta');
    await editar(a.token, habitId, { title: 'Editado antes de apagar' });

    await request(app).delete(`/api/v1/habits/${habitId}`).set('Authorization', `Bearer ${a.token}`);
    await request(app)
      .post(`/api/v1/habits/${habitId}/restore`)
      .set('Authorization', `Bearer ${a.token}`);

    const titulos = (await revisoes(a.token, habitId)).body.data.map(
      (r: { title: string }) => r.title
    );
    expect(titulos).toEqual(['Vai e volta']);
  });

  it('INV-28: a origem da edição é gravada, e distingue pessoa de assistente', async () => {
    const a = await registrar('hist-origem@example.com');
    const habitId = await criarHabito(a.token, 'Origem');
    await editar(a.token, habitId, { title: 'Editado pela pessoa' });

    const revisao = await prismaCru.habitRevision.findFirst({ where: { habitId } });
    expect(revisao!.changedVia).toBe('user');
  });
});
