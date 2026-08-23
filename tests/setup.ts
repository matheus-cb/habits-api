import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { exigirBancoDeTeste } from './lib/exigir-banco-de-teste';

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
  await prisma.checkin.deleteMany();
  await prisma.habit.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
