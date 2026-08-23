import type { NextFunction, Request, Response } from 'express';
import { limitarTaxa } from '@/middlewares/rate-limit.middleware';
import { TooManyRequestsError } from '@/utils/errors';

/**
 * INV-30 — execução arbitrária tem teto.
 *
 * Estes casos são unitários porque a lógica é toda do middleware, e porque o
 * tempo precisa ser controlado: um teste que dependesse do relógio real ou
 * levaria um minuto ou seria instável. `Date.now` é dublado.
 */
function requisicao(over: Partial<Request> = {}): Request {
  return { ip: '10.0.0.1', headers: {}, ...over } as Request;
}

function resposta() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (nome: string, valor: string) => {
      headers[nome] = valor;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

describe('INV-30 — o teto de frequência da execução arbitrária', () => {
  let agora = 1_000_000;

  beforeEach(() => {
    agora = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function chamar(middleware: ReturnType<typeof limitarTaxa>, req = requisicao()) {
    const res = resposta();
    let passou = false;
    const next: NextFunction = () => {
      passou = true;
    };

    try {
      middleware(req, res, next);
      return { passou, res, erro: null as Error | null };
    } catch (erro) {
      return { passou, res, erro: erro as Error };
    }
  }

  it('INV-30: deixa passar até o máximo e recusa a seguinte', () => {
    const limite = limitarTaxa({ janelaMs: 60_000, maximo: 3, nome: 'teste' });

    expect(chamar(limite).passou).toBe(true);
    expect(chamar(limite).passou).toBe(true);
    expect(chamar(limite).passou).toBe(true);

    const quarta = chamar(limite);
    expect(quarta.passou).toBe(false);
    expect(quarta.erro).toBeInstanceOf(TooManyRequestsError);
    expect((quarta.erro as TooManyRequestsError & { statusCode: number }).statusCode).toBe(429);
  });

  it('INV-30: o 429 carrega Retry-After, para o cliente recuar em vez de repetir', () => {
    // Sem este cabeçalho o 429 vira mais uma requisição: um cliente que tenta de
    // novo imediatamente transforma a defesa em amplificação.
    const limite = limitarTaxa({ janelaMs: 30_000, maximo: 1, nome: 'teste' });
    chamar(limite);

    agora += 5_000;
    const recusada = chamar(limite);

    expect(recusada.res.headers['Retry-After']).toBe('25');
  });

  it('INV-30: a janela reabre quando expira', () => {
    const limite = limitarTaxa({ janelaMs: 60_000, maximo: 1, nome: 'teste' });
    expect(chamar(limite).passou).toBe(true);
    expect(chamar(limite).passou).toBe(false);

    agora += 60_001;
    expect(chamar(limite).passou).toBe(true);
  });

  it('INV-30: adversário — o teto é POR identidade, não global', () => {
    // Um teto global seria negação de serviço de graça: um cliente em laço
    // bloquearia todos os outros. É o defeito que o limite existe para evitar,
    // introduzido pelo próprio limite.
    const limite = limitarTaxa({ janelaMs: 60_000, maximo: 1, nome: 'teste' });

    expect(chamar(limite, requisicao({ ip: '10.0.0.1' })).passou).toBe(true);
    expect(chamar(limite, requisicao({ ip: '10.0.0.2' })).passou).toBe(true);
    expect(chamar(limite, requisicao({ ip: '10.0.0.1' })).passou).toBe(false);
  });

  it('INV-30: o userId tem precedência sobre o IP quando existe', () => {
    // Depois do `authenticate`, duas pessoas atrás do mesmo NAT não devem
    // consumir o mesmo teto. Antes dele não há alternativa, e o teto por IP é
    // folgado por causa disso.
    const limite = limitarTaxa({ janelaMs: 60_000, maximo: 1, nome: 'teste' });
    const mesmoIp = { ip: '10.0.0.9', headers: {} };

    const a = requisicao({ ...mesmoIp, user: { id: 'u1', email: 'a@b.c' } } as Partial<Request>);
    const b = requisicao({ ...mesmoIp, user: { id: 'u2', email: 'd@e.f' } } as Partial<Request>);

    expect(chamar(limite, a).passou).toBe(true);
    expect(chamar(limite, b).passou).toBe(true);
    expect(chamar(limite, a).passou).toBe(false);
  });

  it('INV-30: adversário — dois limitadores têm contadores independentes', () => {
    // `/mcp` e `/api/v1` compartilhariam o teto se houvesse um contador só — e
    // como a primitiva `request` chama `/api/v1` pelo loopback, uma chamada MCP
    // consumiria duas unidades de um teto comum.
    const mcp = limitarTaxa({ janelaMs: 60_000, maximo: 1, nome: 'mcp' });
    const api = limitarTaxa({ janelaMs: 60_000, maximo: 1, nome: 'api' });

    expect(chamar(mcp).passou).toBe(true);
    expect(chamar(api).passou).toBe(true);
    expect(chamar(mcp).passou).toBe(false);
  });

  it('INV-30: adversário — o mapa não cresce sem limite com identidades que não voltam', () => {
    // Sem a varredura, um cliente variando o IP a cada requisição vaza memória —
    // o limite de taxa virando o vetor que ele deveria fechar.
    const limite = limitarTaxa({ janelaMs: 1_000, maximo: 5, nome: 'teste' });

    for (let i = 0; i < 1_200; i += 1) {
      chamar(limite, requisicao({ ip: `10.1.${Math.floor(i / 256)}.${i % 256}` }));
    }

    // Passada a janela, a próxima chamada varre — e as 1.200 janelas expiradas
    // saem. O que se observa é que uma identidade nova continua sendo aceita
    // depois de mil e duzentas: nada ficou preso num mapa cheio.
    agora += 2_000;
    expect(chamar(limite, requisicao({ ip: '10.9.9.9' })).passou).toBe(true);
  });
});
