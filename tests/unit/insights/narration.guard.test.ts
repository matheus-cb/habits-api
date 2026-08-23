import { collectAllowedNumbers, extractNumerals, verifyNarration } from '@/insights/narration.guard';
import { DeterministicNarrator } from '@/insights/narrator.deterministic';
import { adherenceReport, habitAdherence } from './fixtures';

describe('INV-14 — numeral que não está no cálculo reprova a redação', () => {
  const report = adherenceReport();

  it('INV-14: texto que só cita números do relatório é aprovado', () => {
    const texto =
      'Nos últimos 30 dias você cumpriu 66.67% dos dias agendados: 8 de 12. A melhor sequência foi de 5 dias.';

    expect(verifyNarration(texto, report)).toEqual({ ok: true, offending: [] });
  });

  it('INV-14: percentual arredondado para o inteiro é aprovado', () => {
    // Arredondar 66.67 para 67 é apresentação. Reprovar isso tornaria o guarda
    // impossível de satisfazer com texto natural, e a IA viraria enfeite
    // permanentemente desligado.
    expect(verifyNarration('Você está em 67% de aderência.', report).ok).toBe(true);
    expect(verifyNarration('Você está em 66% de aderência.', report).ok).toBe(true);
    expect(verifyNarration('Você está em 66.7% de aderência.', report).ok).toBe(true);
  });

  it('INV-14: adversário — o modelo generoso que infla o numerador é reprovado', () => {
    // Este é o caso que existe para ser barrado: "9 de 12" quando o cálculo diz
    // 8 de 12. Texto impecável, número falso, e nenhuma revisão de estilo pega.
    const veredito = verifyNarration('Você cumpriu 9 de 12 dias agendados.', report);

    expect(veredito.ok).toBe(false);
    expect(veredito.offending).toContain('9');
  });

  it('INV-14: adversário — percentual inventado é reprovado', () => {
    const veredito = verifyNarration('Sua aderência está em 82%.', report);

    expect(veredito.ok).toBe(false);
    expect(veredito.offending).toContain('82');
  });

  it('INV-14: adversário — comparação com outras pessoas é reprovada pelo número que ela traz', () => {
    // "acima de 73% dos usuários" é o tipo de frase plausível que um modelo
    // produz sem dado nenhum por trás.
    const veredito = verifyNarration('Você está acima de 73% dos usuários.', report);

    expect(veredito.ok).toBe(false);
    expect(veredito.offending).toContain('73');
  });

  it('INV-14: adversário — projeção para o futuro é reprovada', () => {
    const veredito = verifyNarration('Mantendo o ritmo, em 45 dias você chega a 90%.', report);

    expect(veredito.ok).toBe(false);
    expect(veredito.offending).toEqual(expect.arrayContaining(['45', '90']));
  });

  it('INV-14: adversário — vírgula decimal não é lida como dois números', () => {
    // Se `66,67` fosse partido em "66" e "67", texto correto em português seria
    // reprovado; e pior, um número inventado com vírgula poderia passar.
    expect(extractNumerals('taxa de 66,67% no período')).toEqual([66.67]);
    expect(verifyNarration('Sua taxa é de 66,67%.', report).ok).toBe(true);
    expect(verifyNarration('Sua taxa é de 71,3%.', report).ok).toBe(false);
  });

  it('INV-14: adversário — número escondido no meio de palavra também é inspecionado', () => {
    expect(verifyNarration('meta2026 de 99 dias', report).ok).toBe(false);
  });

  it('INV-14: adversário — data em algarismos é reprovada', () => {
    // Admitir as partes de windowStart/windowEnd liberava todo inteiro de 1 a 31
    // mais o ano, e é nessa faixa que um número fabricado se esconde: "9 de 12"
    // passaria por poder ser um dia do mês. O guarda prefere reprovar a data e o
    // prompt pede o período em palavras ("nos últimos 30 dias").
    expect(verifyNarration('No período de 24/07 a 22/08 de 2026...', report).ok).toBe(false);
    expect(verifyNarration('Nos últimos 30 dias...', report).ok).toBe(true);
  });

  it('INV-14: texto sem número nenhum é sempre aprovado', () => {
    expect(verifyNarration('Sua rotina está mais firme nas manhãs.', report).ok).toBe(true);
  });

  it('INV-14: o conjunto permitido cobre todo campo numérico do relatório', () => {
    // Se um campo novo entrar em `HabitAdherence` e não for admitido aqui, o
    // redator determinístico deixa de passar pelo próprio guarda — e o teste
    // abaixo cai. É o que mantém esta lista honesta com o tempo.
    const permitidos = collectAllowedNumbers(report);
    const habit = report.habits[0]!;

    expect(permitidos.has(habit.completionRate)).toBe(true);
    expect(permitidos.has(habit.completedInWindow)).toBe(true);
    expect(permitidos.has(habit.scheduledDaysInWindow)).toBe(true);
    expect(permitidos.has(habit.currentStreak)).toBe(true);
    expect(permitidos.has(habit.bestStreak)).toBe(true);
    expect(permitidos.has(habit.extraCheckins)).toBe(true);
    expect(permitidos.has(habit.weakestWeekdays[0]!.missed)).toBe(true);
    expect(permitidos.has(habit.extrasByWeekday[0]!.hits)).toBe(true);
    expect(permitidos.has(report.windowDays)).toBe(true);
  });

  it('INV-14: adversário — o redator determinístico passa pelo próprio guarda', () => {
    // O determinístico é o piso: se ele mesmo não passasse, o guarda estaria
    // calibrado errado e o fallback produziria texto que a própria API considera
    // não verificado.
    return Promise.all(
      [
        adherenceReport(),
        adherenceReport({ habits: [] }),
        adherenceReport({
          habits: [
            habitAdherence({ habitId: 'a', title: 'Correr', completionRate: 91.67 }),
            habitAdherence({
              habitId: 'b',
              title: 'Ler',
              completionRate: 25,
              completedInWindow: 3,
              scheduledDaysInWindow: 12,
              currentStreak: 1,
              streakAtRisk: true,
            }),
            habitAdherence({
              habitId: 'c',
              title: 'Meditar',
              completionRate: 40,
              completedInWindow: 4,
              scheduledDaysInWindow: 10,
              currentStreak: 3,
              streakAtRisk: true,
            }),
          ],
        }),
      ].map(async (caso) => {
        const texto = await new DeterministicNarrator().narrate(caso);
        const veredito = verifyNarration(texto, caso);
        expect(veredito).toEqual({ ok: true, offending: [] });
      })
    );
  });

  it('INV-14: adversário — a justificativa determinística também passa pelo guarda', () => {
    const habit = habitAdherence({ completionRate: 50, completedInWindow: 6 });
    const report2 = adherenceReport({ habits: [habit] });
    const plan = {
      habitId: habit.habitId,
      currentScheduledDays: [1, 3, 5],
      proposedScheduledDays: [1, 3],
      removed: [{ weekday: 5, missed: 3, scheduled: 4 }],
      added: [],
    };

    return new DeterministicNarrator()
      .narrateProposal({ plan, habit, report: report2 })
      .then((texto) => {
        expect(verifyNarration(texto, report2)).toEqual({ ok: true, offending: [] });
      });
  });
});
