import { PrismaClient } from '@prisma/client';
import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { exigirBancoDeTeste } from './lib/exigir-banco-de-teste';

/**
 * Client CRU para a limpeza, sem a extensão de soft delete.
 *
 * A extensão proíbe `delete` e `deleteMany` no client da aplicação, para que a
 * irreversibilidade seja estrutural em vez de convencional. A limpeza entre
 * testes É delete físico, e legítimo — então ela usa a mesma porta que o
 * `scripts/purge.ts`: um client próprio.
 *
 * Isto não é contorno da regra; é a regra funcionando. Quando a proibição entrou,
 * ela reprovou os 58 testes de uma vez, apontando o único lugar do repositório
 * que fazia delete físico pelo client errado.
 */
const prismaCru = new PrismaClient();

/**
 * Preparação da Camada 2.
 *
 * Este arquivo apaga as três tabelas antes de **cada** teste. Apontado para o
 * banco de desenvolvimento, ele destrói os dados de quem estiver desenvolvendo —
 * silenciosamente, e sem nada no output que pareça errado. A primeira versão
 * desta camada fazia exatamente isso.
 *
 * A trava vive em `lib/exigir-banco-de-teste.ts` para ter teste próprio na
 * Camada 1, e é uma exceção antes do primeiro `deleteMany`, não um aviso: aviso
 * em saída de teste é lido depois do estrago.
 */
beforeAll(() => {
  exigirBancoDeTeste(env.DATABASE_URL, env.NODE_ENV);
});

beforeEach(async () => {
  await prismaCru.checkin.deleteMany();
  await prismaCru.habit.deleteMany();
  await prismaCru.user.deleteMany();
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), prismaCru.$disconnect()]);
});
