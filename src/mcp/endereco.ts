import type { Server } from 'node:http';
import { env } from '@/config/env';

/**
 * O endereço em que este processo realmente escuta.
 *
 * A primitiva `request` fala com a própria API pelo loopback, o que exige saber a
 * porta. A primeira versão assumia `env.PORT` — e assumir o próprio endereço é
 * errado por dois motivos, um deles já observado:
 *
 * 1. **`PORT` é a porta pedida, não a obtida.** `listen(0)` obtém uma efêmera, e
 *    quem monta a aplicação atrás de outra porta interna também divergiria.
 * 2. **Foi como o teste ponta a ponta falhou com 401.** O gateway saía pelo
 *    socket até a porta 3333 e encontrava o CONTAINER de desenvolvimento: outro
 *    processo, outro banco, outro `JWT_SECRET`. Um 401 cujo diagnóstico aponta
 *    para autenticação quando o defeito é de endereço.
 *
 * `registrarEnderecoLocal` é chamada **depois** do `listen`, com o endereço que o
 * próprio servidor reporta. Antes disso o fallback é `env.PORT`, que é o melhor
 * palpite possível — e continua sendo palpite, então o registro existe para que
 * não seja usado em produção.
 */
let enderecoObservado: string | null = null;

export function registrarEnderecoLocal(servidor: Server): void {
  const endereco = servidor.address();
  if (typeof endereco === 'object' && endereco !== null) {
    // `127.0.0.1` e não o host reportado: em `0.0.0.0` o endereço do servidor é
    // uma máscara, não um destino alcançável.
    enderecoObservado = `http://127.0.0.1:${endereco.port}`;
  }
}

/** Só para teste: desfaz o registro entre casos. */
export function esquecerEnderecoLocal(): void {
  enderecoObservado = null;
}

export function enderecoLocal(): string {
  return enderecoObservado ?? `http://127.0.0.1:${env.PORT}`;
}
