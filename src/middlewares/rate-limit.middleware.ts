import { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '@/utils/errors';

/**
 * Limite de taxa, em memória, por identidade.
 *
 * ## Por que ele virou bloqueante com as primitivas
 *
 * Antes delas, abusar da API era amplificação de custo: um laço de `GET /habits`
 * gasta CPU e uma consulta indexada. A primitiva `query` mudou a categoria — ela
 * executa **SQL arbitrário** com pool próprio contra o mesmo Postgres que serve o
 * dashboard e o mobile. O `statement_timeout` de 5s da role limita cada consulta e
 * não limita a frequência, então N consultas de 5s em paralelo disputam o mesmo
 * servidor. É negação de serviço sem nenhum bug, usando a primitiva exatamente
 * como ela foi projetada.
 *
 * Duas travas, e as duas precisam existir:
 *
 * - **simultaneidade** — `connection_limit=2` no pool da role somente-leitura.
 *   Estrutural: consultas simultâneas esperam na fila em vez de abrir conexão.
 * - **frequência** — este middleware. Sem ele, uma consulta de cada vez em laço
 *   fechado mantém o Postgres ocupado indefinidamente.
 *
 * ## Por que em memória, e o que isso NÃO cobre
 *
 * O contador é do processo. Com réplicas, cada uma tem o seu, e o limite efetivo
 * é `réplicas × teto`. Está dito aqui porque é a limitação que costuma passar por
 * garantia: isto contém laço acidental e uso abusivo de um cliente, e **não** é
 * defesa contra abuso distribuído. Trocar por Redis é o caminho, e é trabalho de
 * quando houver mais de uma réplica — hoje não há.
 *
 * ## A identidade depende de ONDE o middleware está montado
 *
 * A chave é o `userId` quando `req.user` existe, e o IP quando não — e isso não é
 * escolha por requisição, é consequência da posição:
 *
 * - **Montado antes do `authenticate`** (na raiz de `/api/v1` e `/mcp`), sempre
 *   chaveia por IP. É o que contém enxurrada **não autenticada**, que nenhum teto
 *   por usuário poderia conter, porque não há usuário.
 * - **Montado depois do `authenticate`** (dentro do router do MCP), chaveia por
 *   usuário. É o que contém o vetor real, e é o teto que importa.
 *
 * Os dois existem porque nenhum cobre o outro. Atrás de NAT, o teto por IP pune
 * pessoas diferentes pelo consumo de uma — por isso ele é folgado, e o aperto
 * fica no teto por usuário.
 */

interface Janela {
  contagem: number;
  expiraEm: number;
}

export interface OpcoesDeLimite {
  /** Tamanho da janela em milissegundos. */
  janelaMs: number;
  /** Máximo de requisições por identidade dentro da janela. */
  maximo: number;
  /** Vai na mensagem de erro, para a pessoa saber o que foi limitado. */
  nome: string;
}

/**
 * Fábrica, e não singleton: cada superfície tem teto próprio.
 *
 * `/mcp` e `/api/v1` compartilhariam o contador se houvesse um só — e como a
 * primitiva `request` chama `/api/v1` pelo loopback, uma chamada MCP consumiria
 * duas unidades de um teto comum. Contadores separados mantêm cada teto
 * significando o que o nome diz.
 */
export function limitarTaxa({ janelaMs, maximo, nome }: OpcoesDeLimite) {
  const janelas = new Map<string, Janela>();

  // O `Map` cresceria sem limite com identidades que nunca voltam. A varredura é
  // barata porque só roda quando o mapa passa de mil chaves, e é preferível a um
  // `setInterval`, que manteria o processo vivo e apareceria em teste como handle
  // pendurado.
  const limpar = (agora: number) => {
    if (janelas.size <= 1000) return;
    for (const [chave, janela] of janelas) {
      if (janela.expiraEm <= agora) janelas.delete(chave);
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const agora = Date.now();
    limpar(agora);

    const chave = req.user?.id ?? req.ip ?? 'desconhecido';
    const janela = janelas.get(chave);

    if (!janela || janela.expiraEm <= agora) {
      janelas.set(chave, { contagem: 1, expiraEm: agora + janelaMs });
      return next();
    }

    janela.contagem += 1;

    if (janela.contagem > maximo) {
      const segundos = Math.ceil((janela.expiraEm - agora) / 1000);
      // `Retry-After` é o que faz um cliente bem-comportado recuar em vez de
      // tentar de novo imediatamente. Sem ele, o 429 vira mais uma requisição.
      res.setHeader('Retry-After', String(segundos));
      throw new TooManyRequestsError(
        `Limite de ${maximo} requisições por ${janelaMs / 1000}s em ${nome} atingido. ` +
          `Tente em ${segundos}s.`
      );
    }

    return next();
  };
}
