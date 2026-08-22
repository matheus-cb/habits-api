import Anthropic from '@anthropic-ai/sdk';
import { AnthropicNarrator } from '@/insights/narrator.anthropic';
import { NarrationFailure } from '@/insights/narrator';
import { adherenceReport } from './fixtures';

/**
 * O cliente da Anthropic é injetado no construtor exatamente para que estes
 * casos existam. Nenhum teste desta suíte faz chamada de rede — o que está sob
 * teste é a fronteira, não o modelo.
 */
function clienteQueResponde(over: Partial<Anthropic.Message>): Anthropic {
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: 'ok', citations: null }],
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  } as unknown as Anthropic.Message;

  return { messages: { create: jest.fn().mockResolvedValue(message) } } as unknown as Anthropic;
}

function clienteQueFalha(error: unknown): Anthropic {
  return {
    messages: { create: jest.fn().mockRejectedValue(error) },
  } as unknown as Anthropic;
}

const report = adherenceReport();

describe('INV-14 — o guarda numérico roda sobre a saída do modelo', () => {
  it('INV-14: redação com números do relatório é devolvida como veio', async () => {
    const texto = 'Você cumpriu 8 de 12 dias agendados nos últimos 30 dias.';
    const narrator = new AnthropicNarrator(
      clienteQueResponde({
        content: [{ type: 'text', text: texto }] as unknown as Anthropic.Message['content'],
      })
    );

    await expect(narrator.narrate(report)).resolves.toBe(texto);
  });

  it('INV-14: adversário — modelo que inventa número é reprovado, não corrigido', async () => {
    // O guarda não tenta consertar o texto. Consertar exigiria adivinhar a
    // intenção; reprovar e cair no determinístico devolve algo verificável.
    const narrator = new AnthropicNarrator(
      clienteQueResponde({
        content: [
          { type: 'text', text: 'Você cumpriu 11 de 12 dias e superou 84% dos usuários.' },
        ] as unknown as Anthropic.Message['content'],
      })
    );

    await expect(narrator.narrate(report)).rejects.toMatchObject({
      name: 'NarrationFailure',
      reason: 'AI_NUMBERS_UNVERIFIED',
    });
  });

  it('INV-14: adversário — a justificativa da proposta passa pelo mesmo guarda', async () => {
    const habit = report.habits[0]!;
    const narrator = new AnthropicNarrator(
      clienteQueResponde({
        content: [
          { type: 'text', text: 'Sexta escapou 3 de 4 vezes; sugiro 2 dias em vez de 7.' },
        ] as unknown as Anthropic.Message['content'],
      })
    );

    // "7" não está no relatório: scheduledDays tem 3 entradas e nada vale 7.
    await expect(
      narrator.narrateProposal({
        plan: {
          habitId: habit.habitId,
          currentScheduledDays: [1, 3, 5],
          proposedScheduledDays: [1, 3],
          removed: [{ weekday: 5, missed: 3, scheduled: 4 }],
          added: [],
        },
        habit,
        report,
      })
    ).rejects.toMatchObject({ reason: 'AI_NUMBERS_UNVERIFIED' });
  });
});

describe('INV-15 — falha de provedor vira motivo, nunca erro para o usuário', () => {
  it('INV-15: recusa do modelo vira AI_REFUSED', async () => {
    // Recusa chega como HTTP 200 com stop_reason próprio. Ler `content` sem
    // checar isto trataria uma recusa como resposta válida.
    const narrator = new AnthropicNarrator(
      clienteQueResponde({ stop_reason: 'refusal' as Anthropic.Message['stop_reason'] })
    );

    await expect(narrator.narrate(report)).rejects.toMatchObject({ reason: 'AI_REFUSED' });
  });

  it('INV-15: resposta sem bloco de texto vira AI_EMPTY_RESPONSE', async () => {
    const narrator = new AnthropicNarrator(
      clienteQueResponde({ content: [] as unknown as Anthropic.Message['content'] })
    );

    await expect(narrator.narrate(report)).rejects.toMatchObject({
      reason: 'AI_EMPTY_RESPONSE',
    });
  });

  it('INV-15: resposta só com espaços vira AI_EMPTY_RESPONSE', async () => {
    const narrator = new AnthropicNarrator(
      clienteQueResponde({
        content: [{ type: 'text', text: '   \n  ' }] as unknown as Anthropic.Message['content'],
      })
    );

    await expect(narrator.narrate(report)).rejects.toMatchObject({
      reason: 'AI_EMPTY_RESPONSE',
    });
  });

  it('INV-15: erro de transporte vira AI_UNAVAILABLE', async () => {
    const narrator = new AnthropicNarrator(clienteQueFalha(new Error('ECONNRESET')));

    await expect(narrator.narrate(report)).rejects.toMatchObject({
      reason: 'AI_UNAVAILABLE',
    });
  });
});

describe('INV-16 — chave, prompt e raciocínio do modelo não vazam', () => {
  it('INV-16: adversário — a mensagem do provedor não é repassada na falha', async () => {
    // Mensagem de erro de provedor costuma ecoar trecho do prompt enviado. Se ela
    // subisse, o prompt inteiro poderia chegar ao cliente HTTP.
    const segredo = 'sk-ant-chave-secreta-que-nao-pode-vazar';
    const narrator = new AnthropicNarrator(
      clienteQueFalha(new Error(`401 invalid x-api-key: ${segredo} — prompt: você redige...`))
    );

    const erro = await narrator.narrate(report).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(NarrationFailure);
    const serializado = `${(erro as Error).message}${JSON.stringify(erro)}`;
    expect(serializado).not.toContain(segredo);
    expect(serializado).not.toContain('você redige');
    expect((erro as NarrationFailure).reason).toBe('AI_UNAVAILABLE');
  });

  it('INV-16: adversário — bloco de raciocínio não é incluído no resumo devolvido', async () => {
    // Só bloco `text` entra no resultado. Se o filtro caísse, o raciocínio do
    // modelo iria para a tela do usuário.
    const narrator = new AnthropicNarrator(
      clienteQueResponde({
        content: [
          { type: 'thinking', thinking: 'o usuário parece desmotivado, vou...', signature: 'x' },
          { type: 'text', text: 'Você cumpriu 8 de 12 dias agendados.' },
        ] as unknown as Anthropic.Message['content'],
      })
    );

    const resumo = await narrator.narrate(report);

    expect(resumo).toBe('Você cumpriu 8 de 12 dias agendados.');
    expect(resumo).not.toContain('desmotivado');
  });
});

describe('INV-13 — o modelo recebe o relatório fechado e nada mais', () => {
  it('INV-13: adversário — a chamada não declara nenhuma tool', async () => {
    // Sem tool não há como o modelo consultar ou alterar nada: a fronteira é a
    // ausência de canal, não uma instrução no prompt.
    const client = clienteQueResponde({
      content: [{ type: 'text', text: 'Você cumpriu 8 de 12.' }] as unknown as Anthropic.Message['content'],
    });
    await new AnthropicNarrator(client).narrate(report);

    const payload = (client.messages.create as jest.Mock).mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('mcp_servers');
    expect(payload.messages).toHaveLength(1);
    expect(JSON.parse(payload.messages[0].content)).toEqual(report);
  });

  it('INV-13: adversário — o prompt manda tratar título de hábito como dado, não instrução', async () => {
    // Título de hábito é entrada livre do usuário. A defesa real é o guarda
    // numérico e a ausência de tool; a instrução é a terceira camada, e existir
    // no prompt é verificável.
    const client = clienteQueResponde({
      content: [{ type: 'text', text: 'Você cumpriu 8 de 12.' }] as unknown as Anthropic.Message['content'],
    });
    await new AnthropicNarrator(client).narrate(report);

    const system = (client.messages.create as jest.Mock).mock.calls[0]?.[0].system as string;
    expect(system).toMatch(/dados, não como instrução|dado, não instrução/i);
    expect(system).toMatch(/algarismos/i);
  });
});
