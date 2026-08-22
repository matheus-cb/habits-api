/**
 * Trava contra apagar tabelas no banco errado.
 *
 * Mora fora de `tests/setup.ts` para poder ser testada na Camada 1. Uma trava sem
 * teste é a pior espécie: ela dá a sensação de proteção e ninguém verifica se o
 * `_test$` do regex não virou `_test` em qualquer posição, ou se a exceção não
 * foi rebaixada a mensagem de log numa refatoração.
 */
export function exigirBancoDeTeste(databaseUrl: string, nodeEnv: string): void {
  if (nodeEnv !== 'test') {
    throw new Error(`A Camada 2 apaga tabelas e só roda com NODE_ENV=test; está "${nodeEnv}".`);
  }

  let nome: string;
  try {
    nome = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL não é uma URL válida; recusando apagar tabelas.');
  }

  if (!/_test$/.test(nome)) {
    throw new Error(
      [
        `A Camada 2 apaga TODAS as tabelas e o banco apontado é "${nome}", que não termina em "_test".`,
        'Recusando para não destruir dados de desenvolvimento.',
        'Use .env.test (carregado automaticamente) e crie o banco com:',
        '  npm run db:test:create && npm run db:test:migrate',
      ].join('\n')
    );
  }
}
