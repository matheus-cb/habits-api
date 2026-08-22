import { InsightsService } from '@/insights/insights.service';
import { NarrationFailure, Narrator } from '@/insights/narrator';
import { DeterministicNarrator } from '@/insights/narrator.deterministic';
import { verifyNarration } from '@/insights/narration.guard';
import { adherenceReport, habitAdherence } from './fixtures';

const report = adherenceReport({
  habits: [
    habitAdherence({
      habitId: 'habit-1',
      completionRate: 50,
      completedInWindow: 6,
      weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
      extrasByWeekday: [],
    }),
  ],
});

const adherence = { buildReport: jest.fn() };
const proposals = {
  buildProposals: jest.fn(),
  sign: jest.fn(),
  confirm: jest.fn(),
};

function narratorFalso(over: Partial<Narrator> = {}): Narrator {
  return {
    source: 'model',
    narrate: jest.fn().mockResolvedValue('Você cumpriu 6 de 12 dias agendados.'),
    narrateProposal: jest.fn().mockResolvedValue('Sexta escapou 4 de 4 vezes.'),
    ...over,
  } as Narrator;
}

function servico(preferido: Narrator | null) {
  return new InsightsService(
    adherence as never,
    proposals as never,
    preferido,
    new DeterministicNarrator()
  );
}

beforeEach(() => {
  // `resetMocks: true` no jest.unit.config.js limpa a implementação antes de cada
  // teste; definir aqui é o que mantém os dublês vivos.
  adherence.buildReport.mockResolvedValue(report);
  proposals.buildProposals.mockReturnValue([]);
  proposals.sign.mockReturnValue({ token: 'tok.sig', expiresAt: new Date('2026-08-22T12:00:00Z') });
});

describe('INV-15 — sem provedor configurado a API segue íntegra', () => {
  it('INV-15: sem redator preferido o resumo vem do determinístico e o motivo é declarado', async () => {
    const resultado = await servico(null).getAdherence('user-1');

    expect(resultado.narration.source).toBe('deterministic');
    expect(resultado.narration.fallbackReason).toBe('AI_NOT_CONFIGURED');
    expect(resultado.narration.summary.length).toBeGreaterThan(0);
    // O relatório é idêntico com ou sem IA: os números não passam pelo modelo.
    expect(resultado.report).toEqual(report);
  });

  it('INV-15: com redator preferido funcionando, o resumo é dele e não há motivo de fallback', async () => {
    const resultado = await servico(narratorFalso()).getAdherence('user-1');

    expect(resultado.narration.source).toBe('model');
    expect(resultado.narration.fallbackReason).toBeUndefined();
    expect(resultado.narration.summary).toBe('Você cumpriu 6 de 12 dias agendados.');
  });

  it('INV-15: adversário — redação reprovada pelo guarda cai no determinístico com o motivo', async () => {
    const preferido = narratorFalso({
      narrate: jest.fn().mockRejectedValue(new NarrationFailure('AI_NUMBERS_UNVERIFIED')),
    });

    const resultado = await servico(preferido).getAdherence('user-1');

    expect(resultado.narration.source).toBe('deterministic');
    expect(resultado.narration.fallbackReason).toBe('AI_NUMBERS_UNVERIFIED');
    expect(verifyNarration(resultado.narration.summary, report).ok).toBe(true);
  });

  it('INV-15: adversário — provedor indisponível não propaga erro para quem chamou', async () => {
    const preferido = narratorFalso({
      narrate: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
    });

    const resultado = await servico(preferido).getAdherence('user-1');

    expect(resultado.narration.source).toBe('deterministic');
    expect(resultado.narration.fallbackReason).toBe('AI_UNAVAILABLE');
  });

  it('INV-15: adversário — o mesmo relatório sai igual com e sem IA', async () => {
    const comIa = await servico(narratorFalso()).getAdherence('user-1');
    const semIa = await servico(null).getAdherence('user-1');

    expect(comIa.report).toEqual(semIa.report);
  });
});

describe('INV-16 — nenhum motivo de fallback carrega detalhe do provedor', () => {
  it('INV-16: adversário — a mensagem do erro do provedor não aparece na resposta', async () => {
    const segredo = 'sk-ant-vazamento';
    const preferido = narratorFalso({
      narrate: jest.fn().mockRejectedValue(new Error(`401 x-api-key ${segredo}`)),
    });

    const resultado = await servico(preferido).getAdherence('user-1');

    expect(JSON.stringify(resultado)).not.toContain(segredo);
    expect(JSON.stringify(resultado)).not.toContain('x-api-key');
    // O motivo é sempre um dos cinco códigos fechados.
    expect(['AI_NOT_CONFIGURED', 'AI_UNAVAILABLE', 'AI_REFUSED', 'AI_NUMBERS_UNVERIFIED', 'AI_EMPTY_RESPONSE']).toContain(
      resultado.narration.fallbackReason
    );
  });
});

describe('INV-13 — os números do relatório nunca passam pelo modelo', () => {
  it('INV-13: o redator recebe o relatório já fechado, e o service não altera nada depois', async () => {
    const preferido = narratorFalso();
    const resultado = await servico(preferido).getAdherence('user-1');

    expect(preferido.narrate).toHaveBeenCalledWith(report);
    expect(resultado.report).toBe(report);
  });

  it('INV-13: adversário — o resumo do modelo não pode alterar nenhum campo do relatório', async () => {
    // O contrato é `Promise<string>`: não existe caminho por onde a redação
    // devolva número. Este teste registra a intenção junto ao tipo.
    const preferido = narratorFalso({
      narrate: jest.fn().mockResolvedValue('Você cumpriu 6 de 12 dias agendados.'),
    });

    const resultado = await servico(preferido).getAdherence('user-1');

    expect(resultado.report.habits[0]!.completionRate).toBe(50);
    expect(resultado.report.habits[0]!.completedInWindow).toBe(6);
  });
});

describe('INV-18 — a justificativa da proposta também cai no determinístico', () => {
  it('INV-18: proposta assinada é devolvida com justificativa do modelo quando ele responde', async () => {
    const habit = report.habits[0]!;
    proposals.buildProposals.mockReturnValue([
      {
        habitId: habit.habitId,
        currentScheduledDays: [1, 3, 5],
        proposedScheduledDays: [1, 3],
        removed: [{ weekday: 5, missed: 4, scheduled: 4 }],
        added: [],
      },
    ]);

    const [proposta] = await servico(narratorFalso()).getProposals('user-1');

    expect(proposta?.rationaleSource).toBe('model');
    expect(proposta?.token).toBe('tok.sig');
    expect(proposta?.proposedScheduledDays).toEqual([1, 3]);
  });

  it('INV-18: adversário — justificativa reprovada cai no determinístico sem derrubar a proposta', async () => {
    // A proposta é o produto; a justificativa é acessório. Se a redação falha, a
    // pessoa ainda precisa poder decidir — com um texto verificável.
    const habit = report.habits[0]!;
    proposals.buildProposals.mockReturnValue([
      {
        habitId: habit.habitId,
        currentScheduledDays: [1, 3, 5],
        proposedScheduledDays: [1, 3],
        removed: [{ weekday: 5, missed: 4, scheduled: 4 }],
        added: [],
      },
    ]);
    const preferido = narratorFalso({
      narrateProposal: jest.fn().mockRejectedValue(new NarrationFailure('AI_REFUSED')),
    });

    const [proposta] = await servico(preferido).getProposals('user-1');

    expect(proposta?.rationaleSource).toBe('deterministic');
    expect(proposta?.rationale.length).toBeGreaterThan(0);
    expect(proposta?.proposedScheduledDays).toEqual([1, 3]);
  });

  it('INV-18: sem sinal, a lista de propostas é vazia — e isso é resultado normal', async () => {
    proposals.buildProposals.mockReturnValue([]);

    await expect(servico(narratorFalso()).getProposals('user-1')).resolves.toEqual([]);
  });
});
