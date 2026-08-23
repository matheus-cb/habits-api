import { aguardarFechamentos, registrarFechamento } from '@/mcp/fechamentos';

/**
 * O registro de fechamentos, e os dois casos que o tornam confiável.
 *
 * Um `aguardarFechamentos` que retornasse imediatamente deixaria a suíte de
 * integração exatamente como estava — e passaria, porque o teardown que o chama
 * não afirma nada. Sem estes casos, a correção seria decorativa.
 */
describe('aguardarFechamentos — espera de verdade', () => {
  it('espera um fechamento em voo antes de resolver', async () => {
    let concluiu = false;
    registrarFechamento(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          concluiu = true;
          resolve();
        }, 40)
      )
    );

    await aguardarFechamentos();

    expect(concluiu).toBe(true);
  });

  it('adversário — espera o fechamento que NASCE de outro fechamento', async () => {
    // O caso que exige o laço, e o que uma única espera perderia. Fechar o
    // transporte encerra a resposta, e o handler de `close` da resposta registra
    // outro fechamento — então esperar uma vez deixaria o segundo em voo, que é
    // exatamente o defeito que esta função existe para fechar.
    const ordem: string[] = [];

    registrarFechamento(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          ordem.push('primeiro');
          // Nasce DEPOIS que o primeiro já saiu do conjunto de pendentes.
          registrarFechamento(
            new Promise<void>((r) =>
              setTimeout(() => {
                ordem.push('segundo');
                r();
              }, 30)
            )
          );
          resolve();
        }, 20)
      )
    );

    await aguardarFechamentos();

    expect(ordem).toEqual(['primeiro', 'segundo']);
  });

  it('adversário — rejeição não deixa a espera pendurada para sempre', async () => {
    // `finally` e não `then` na remoção. Com `then`, uma promessa rejeitada nunca
    // sairia do conjunto e `aguardarFechamentos` giraria eternamente — o
    // teardown viraria um travamento, que é pior que o problema original.
    registrarFechamento(Promise.reject(new Error('fechamento falhou')));

    await expect(aguardarFechamentos()).resolves.toBeUndefined();
  });

  it('sem nada pendente, resolve na hora', async () => {
    await expect(aguardarFechamentos()).resolves.toBeUndefined();
  });
});
