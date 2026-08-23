import { planReschedule } from '@/insights/reschedule.engine';
import { habitAdherence } from './fixtures';

describe('INV-18 — o motor determinístico decide os dias', () => {
  it('INV-18: hábito com aderência boa não gera proposta', () => {
    // Propor mudança sem necessidade é o modo de falha mais provável desta
    // funcionalidade, e o mais fácil de disfarçar com texto convincente.
    expect(
      planReschedule(
        habitAdherence({
          completionRate: 85,
          weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 1 }],
        })
      )
    ).toBeNull();
  });

  it('INV-18: dia que falha acima do limite sai da proposta', () => {
    const plano = planReschedule(
      habitAdherence({
        completionRate: 50,
        scheduledDays: [1, 3, 5],
        weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
        extrasByWeekday: [],
      })
    );

    expect(plano?.proposedScheduledDays).toEqual([1, 3]);
    expect(plano?.removed).toEqual([{ weekday: 5, missed: 4, scheduled: 4 }]);
  });

  it('INV-18: dia cumprido espontaneamente entra na proposta', () => {
    const plano = planReschedule(
      habitAdherence({
        completionRate: 50,
        scheduledDays: [1, 3],
        weakestWeekdays: [],
        extrasByWeekday: [{ weekday: 6, hits: 3 }],
      })
    );

    expect(plano?.proposedScheduledDays).toEqual([1, 3, 6]);
    expect(plano?.added).toEqual([{ weekday: 6, hits: 3 }]);
  });

  it('INV-18: adversário — uma única falha não move o agendamento', () => {
    // Uma semana ruim não é padrão. Sem o mínimo de ocorrências, qualquer
    // tropeço isolado viraria proposta e o recurso perderia credibilidade.
    expect(
      planReschedule(
        habitAdherence({
          completionRate: 50,
          weakestWeekdays: [{ weekday: 5, scheduled: 1, missed: 1 }],
          extrasByWeekday: [],
        })
      )
    ).toBeNull();
  });

  it('INV-18: adversário — um único check-in espontâneo não adiciona dia', () => {
    expect(
      planReschedule(
        habitAdherence({
          completionRate: 50,
          scheduledDays: [1, 3],
          weakestWeekdays: [],
          extrasByWeekday: [{ weekday: 6, hits: 1 }],
        })
      )
    ).toBeNull();
  });

  it('INV-07/INV-18: adversário — a proposta nunca fica vazia', () => {
    // Vazio significa "todo dia" (INV-07): esvaziar o conjunto para aliviar a
    // rotina faria exatamente o oposto do que a proposta promete. Quando todos os
    // dias falham acima do limite, o menos falhado é resgatado.
    const plano = planReschedule(
      habitAdherence({
        completionRate: 10,
        scheduledDays: [1, 3],
        weakestWeekdays: [
          { weekday: 1, scheduled: 4, missed: 4 },
          { weekday: 3, scheduled: 4, missed: 3 },
        ],
        extrasByWeekday: [],
      })
    );

    expect(plano?.proposedScheduledDays).toHaveLength(1);
    expect(plano?.proposedScheduledDays).toEqual([3]);
  });

  it('INV-07/INV-18: adversário — a proposta é sempre subconjunto ordenado de 0..6 sem repetição', () => {
    const plano = planReschedule(
      habitAdherence({
        completionRate: 30,
        scheduledDays: [5, 1, 3],
        weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
        extrasByWeekday: [
          { weekday: 6, hits: 3 },
          { weekday: 0, hits: 2 },
        ],
      })
    );

    const dias = plano!.proposedScheduledDays;
    expect(dias).toEqual([...dias].sort((a, b) => a - b));
    expect(new Set(dias).size).toBe(dias.length);
    expect(dias.every((dia) => dia >= 0 && dia <= 6)).toBe(true);
  });

  it('INV-18: adversário — dia já agendado não é proposto como adição', () => {
    // `extrasByWeekday` nunca deveria conter dia agendado, mas se o relatório
    // mudasse, duplicar o dia sujaria o conjunto e inflaria o denominador.
    const plano = planReschedule(
      habitAdherence({
        completionRate: 50,
        scheduledDays: [1, 3],
        weakestWeekdays: [],
        extrasByWeekday: [{ weekday: 3, hits: 5 }],
      })
    );

    expect(plano).toBeNull();
  });

  it('INV-18: hábito "todo dia" não é reagendável por este motor', () => {
    // Remover dias de um conjunto vazio exigiria primeiro escolher os sete, e o
    // sinal de falha por dia da semana não sustenta essa decisão.
    expect(
      planReschedule(
        habitAdherence({
          scheduledDays: [],
          completionRate: 20,
          weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
        })
      )
    ).toBeNull();
  });

  it('INV-18: hábito sem dia agendado na janela não gera proposta', () => {
    expect(
      planReschedule(habitAdherence({ scheduledDaysInWindow: 0, completionRate: 0 }))
    ).toBeNull();
  });

  it('INV-18: plano que não muda nada não é proposta', () => {
    // O sinal de falha aponta para sexta, mas sexta não está agendada: não há o
    // que remover nem o que adicionar. Devolver "sugestão" que não muda nada
    // treinaria a pessoa a confirmar sem ler.
    expect(
      planReschedule(
        habitAdherence({
          completionRate: 50,
          scheduledDays: [1, 3],
          weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
          extrasByWeekday: [],
        })
      )
    ).toBeNull();
  });

  it('INV-18: o motor é determinístico — mesma entrada, mesma saída', () => {
    const entrada = habitAdherence({
      completionRate: 40,
      scheduledDays: [1, 3, 5],
      weakestWeekdays: [
        { weekday: 5, scheduled: 4, missed: 4 },
        { weekday: 3, scheduled: 4, missed: 3 },
      ],
      extrasByWeekday: [{ weekday: 2, hits: 4 }],
    });

    const primeira = planReschedule(entrada);
    const segunda = planReschedule(entrada);

    expect(primeira).toEqual(segunda);
  });
});
