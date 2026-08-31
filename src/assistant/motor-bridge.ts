import { env } from '@/config/env';
import { BadRequestError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import type { RespostaDoCli } from './motor-cli';

/**
 * Cliente da ponte privada que executa o Claude Code no host.
 *
 * A API nunca monta o binário, a credencial OAuth ou o HOME do Claude no
 * container. Ela envia à ponte somente o JWT efêmero da pessoa e o id da
 * conversa, para a ponte montar um `mcp.json` temporário para `/mcp/assistente`.
 */
export function ponteDisponivel(): { ok: boolean; motivo?: string } {
  const url = env.CLAUDE_BRIDGE_BASE_URL?.trim();
  const segredo = env.CLAUDE_BRIDGE_SECRET?.trim();

  if (!url || !segredo) {
    return {
      ok: false,
      motivo:
        'A ponte privada do Claude Code não está configurada. Configure CLAUDE_BRIDGE_BASE_URL e CLAUDE_BRIDGE_SECRET.',
    };
  }

  try {
    const destino = new URL(url);
    if (destino.protocol !== 'http:' && destino.protocol !== 'https:') {
      return { ok: false, motivo: 'A URL da ponte do Claude Code precisa usar HTTP ou HTTPS.' };
    }
  } catch {
    return { ok: false, motivo: 'A URL da ponte do Claude Code é inválida.' };
  }

  return { ok: true };
}

export class MotorBridge {
  async perguntar(input: {
    token: string;
    conversationId: string;
    sessionId: string | null;
    mensagem: string;
    sistema: string;
  }): Promise<RespostaDoCli> {
    const disponibilidade = ponteDisponivel();
    if (!disponibilidade.ok) throw new BadRequestError(disponibilidade.motivo!);

    const controle = new globalThis.AbortController();
    const relogio = setTimeout(() => controle.abort(), env.ASSISTANT_BRIDGE_TIMEOUT_MS);

    try {
      const resposta = await fetch(`${env.CLAUDE_BRIDGE_BASE_URL!.replace(/\/$/, '')}/habits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controle.signal,
        body: JSON.stringify({
          segredo: env.CLAUDE_BRIDGE_SECRET,
          token: input.token,
          conversationId: input.conversationId,
          sessionId: input.sessionId,
          mensagem: input.mensagem,
          sistema: input.sistema,
        }),
      });

      const corpo = (await resposta.json().catch(() => null)) as unknown;
      if (!resposta.ok || !ehRespostaDaPonte(corpo)) {
        logger.error('ponte do Claude Code recusou a chamada', { status: resposta.status });
        throw new BadRequestError('O assistente não conseguiu responder agora.');
      }

      return corpo.resposta;
    } catch (erro) {
      if (erro instanceof BadRequestError) throw erro;
      logger.error('falha ao chamar a ponte do Claude Code', {
        nome: erro instanceof Error ? erro.name : 'erro_desconhecido',
      });
      throw new BadRequestError('O assistente não conseguiu responder agora.');
    } finally {
      clearTimeout(relogio);
    }
  }
}

function ehRespostaDaPonte(valor: unknown): valor is { resposta: RespostaDoCli } {
  if (typeof valor !== 'object' || valor === null || !('resposta' in valor)) return false;
  const resposta = valor.resposta as Partial<RespostaDoCli>;
  return (
    typeof resposta.texto === 'string' &&
    typeof resposta.sessionId === 'string' &&
    typeof resposta.turnos === 'number' &&
    typeof resposta.custoUsd === 'number' &&
    typeof resposta.tokensDeSaida === 'number' &&
    typeof resposta.duracaoMs === 'number' &&
    typeof resposta.desfecho === 'string'
  );
}
