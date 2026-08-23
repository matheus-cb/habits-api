import fs from 'node:fs';
import path from 'node:path';
import { exigirBancoDeTeste } from '../lib/exigir-banco-de-teste';

const RAIZ = path.join(__dirname, '..', '..');
const DEV = 'postgresql://postgres:postgres@localhost:5432/habits?schema=public';
const TESTE = 'postgresql://postgres:postgres@localhost:5432/habits_test?schema=public';

describe('trava de banco — a Camada 2 nunca apaga tabela de desenvolvimento', () => {
  it('aceita banco terminado em _test com NODE_ENV=test', () => {
    expect(() => exigirBancoDeTeste(TESTE, 'test')).not.toThrow();
  });

  it('adversário — recusa o banco de desenvolvimento', () => {
    // Este é o caso que existe para ser barrado. A primeira versão desta camada
    // usava o .env de desenvolvimento: rodar a suíte apagava os hábitos reais de
    // quem estivesse trabalhando, sem nenhum sinal na saída.
    expect(() => exigirBancoDeTeste(DEV, 'test')).toThrow(/não termina em "_test"/);
  });

  it('adversário — recusa nome que só CONTÉM _test, sem terminar nele', () => {
    // `habits_test_backup` passaria num `includes('_test')`. O regex é ancorado
    // no fim justamente por isso.
    expect(() =>
      exigirBancoDeTeste('postgresql://u:p@h:5432/habits_test_backup', 'test')
    ).toThrow(/não termina em "_test"/);
  });

  it('adversário — recusa NODE_ENV diferente de test, mesmo com banco _test', () => {
    expect(() => exigirBancoDeTeste(TESTE, 'development')).toThrow(/NODE_ENV=test/);
    expect(() => exigirBancoDeTeste(TESTE, 'production')).toThrow(/NODE_ENV=test/);
  });

  it('adversário — recusa DATABASE_URL malformada em vez de deixar passar', () => {
    // Se a URL não parseia, o nome do banco é desconhecido — e desconhecido não
    // pode ser tratado como seguro.
    expect(() => exigirBancoDeTeste('nao-e-url', 'test')).toThrow(/não é uma URL válida/);
  });

  it('a trava é uma EXCEÇÃO, não um aviso — verificado no código', () => {
    // Trocar o `throw` por `console.warn` numa refatoração deixaria a trava com
    // aparência de proteção e efeito nenhum, e o teste acima continuaria passando
    // se ele só checasse a mensagem.
    const fonte = fs.readFileSync(
      path.join(RAIZ, 'tests', 'lib', 'exigir-banco-de-teste.ts'),
      'utf8'
    );
    expect(fonte).toMatch(/throw new Error/);
    expect(fonte).not.toMatch(/console\.(warn|log|error)/);
  });

  it('o .env.test do repositório aponta para um banco que a trava aceita', () => {
    // Fecha o laço: a trava é correta E a configuração que o repositório entrega
    // passa por ela. Sem este caso, um .env.test errado só apareceria na primeira
    // execução da Camada 2.
    const envTest = fs.readFileSync(path.join(RAIZ, '.env.test'), 'utf8');
    const url = /DATABASE_URL="?([^"\n]+)"?/.exec(envTest)?.[1];
    const nodeEnv = /NODE_ENV=(\S+)/.exec(envTest)?.[1];

    expect(url).toBeDefined();
    expect(() => exigirBancoDeTeste(url!, nodeEnv!)).not.toThrow();
  });
});
