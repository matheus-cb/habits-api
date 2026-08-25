/**
 * INV-42 — registro fecha por default, e a rota continua registrada.
 *
 * O caso que mais importa aqui é o do DEFAULT. Os outros dois provam que a
 * guarda funciona nos dois estados; o do default prova que o estado seguro é o
 * que vale quando ninguém configurou nada — que é a condição real de um servidor
 * novo, e a única em que o erro é silencioso.
 */
import fs from 'node:fs';

describe('INV-42 — criação de conta por HTTP', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  it('INV-42: sem a variável no ambiente, o registro nasce FECHADO', async () => {
    jest.resetModules();
    delete process.env.REGISTRO;

    const { env, registroAberto } = await import('@/config/env');

    expect(env.REGISTRO).toBe('fechado');
    expect(registroAberto()).toBe(false);
  });

  it('INV-42: adversário — com o registro fechado, a guarda recusa e diz o motivo', async () => {
    jest.resetModules();
    process.env.REGISTRO = 'fechado';

    const { exigirRegistroAberto } = await import('@/middlewares/registro.middleware');

    // Asserção sobre EFEITO: o que a guarda faz é chamar `next` com o erro. Um
    // teste que só verificasse "a guarda foi chamada" passaria com ela vazia.
    const next = jest.fn();
    exigirRegistroAberto({} as never, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    const erro = next.mock.calls[0][0] as { statusCode: number; message: string };

    // `toBeInstanceOf(ForbiddenError)` NÃO serve aqui, e a armadilha é sutil:
    // `jest.resetModules()` faz o import dinâmico carregar um registro novo, então
    // a classe que o middleware lança é um objeto DIFERENTE da importada no topo
    // deste arquivo. A asserção falharia com "Expected: ForbiddenError, Received:
    // ForbiddenError". O que importa é o efeito — status e razão —, não a
    // identidade do construtor.
    // `constructor.name` e não `name`: as subclasses de `AppError` não atribuem
    // `name`, então ele vale 'Error'. O `constructor.name` reporta a subclasse
    // porque o `AppError` faz `setPrototypeOf(this, new.target.prototype)` — e o
    // comentário lá registra que fixar em `AppError.prototype` apagava
    // exatamente esta identidade.
    expect(erro.constructor.name).toBe('ForbiddenError');
    expect(erro.statusCode).toBe(403);
    // A RAZÃO, não só o status: 403 sem motivo é indistinguível de bug de
    // permissão, e quem administra precisa saber que a causa é configuração.
    expect(erro.message).toMatch(/REGISTRO=fechado/);
  });

  it('INV-42: com REGISTRO=aberto a guarda deixa passar', async () => {
    jest.resetModules();
    process.env.REGISTRO = 'aberto';

    const { exigirRegistroAberto } = await import('@/middlewares/registro.middleware');

    const next = jest.fn();
    exigirRegistroAberto({} as never, {} as never, next);

    // Sem argumento: `next(erro)` desvia para o error handler, `next()` segue a
    // cadeia. A diferença entre os dois é a invariante inteira.
    expect(next).toHaveBeenCalledWith();
  });

  it('INV-42: valor fora do enum impede a inicialização', async () => {
    jest.resetModules();
    process.env.REGISTRO = 'talvez';

    // Mesma escolha de INV-09: um valor que ninguém previu não pode cair num
    // default silencioso, porque `talvez` seria lido como "não é aberto" e
    // funcionaria — até o dia em que alguém escrevesse `abertO` querendo abrir.
    await expect(async () => {
      await import('@/config/env');
    }).rejects.toThrow('Invalid environment variables');
  });

  it('INV-42: a guarda vem ANTES do validateBody na rota', () => {
    // Leitura estática, no precedente de INV-39. A ordem é a invariante: validar
    // primeiro responderia 400 com a forma do schema a quem está recusado de todo
    // modo, e faria a resposta depender do corpo enviado.
    // Normalizar `\r\n` NÃO é zelo: num checkout Windows (`core.autocrlf=true`,
    // e o repositório não tem `.gitattributes`) toda âncora escrita com `\n`
    // deixa de casar, e o teste reprova por causa do checkout em vez do código.
    // É a mesma cegueira que hoje faz os gates de INV-37 e INV-41 reprovarem no
    // Windows e passarem no CI.
    const fonte = fs.readFileSync('src/routes/auth.routes.ts', 'utf8').replace(/\r\n/g, '\n');
    const inicio = fonte.indexOf("router.post(\n  '/register'");
    const registro = inicio === -1 ? '' : fonte.slice(inicio);

    expect(registro).not.toBe('');
    expect(registro.indexOf('exigirRegistroAberto')).toBeLessThan(
      registro.indexOf('validateBody')
    );
  });
});
