import { ProposalService } from '@/insights/proposal.service';
import { planReschedule } from '@/insights/reschedule.engine';
import { habitAdherence } from './fixtures';

const mockHabitsRepository = { findById: jest.fn(), update: jest.fn() };
const service = new ProposalService(mockHabitsRepository as never);

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const HABIT_ID = 'habit-1';

const plan = {
  habitId: HABIT_ID,
  currentScheduledDays: [1, 3, 5],
  proposedScheduledDays: [1, 3],
  removed: [{ weekday: 5, missed: 3, scheduled: 4 }],
  added: [],
};

const habitGravado = {
  id: HABIT_ID,
  userId: USER_ID,
  title: 'Correr',
  description: null,
  scheduledDays: [1, 3, 5],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date(),
};

function arrangeHabit(over: Partial<typeof habitGravado> = {}) {
  mockHabitsRepository.findById.mockResolvedValueOnce({ ...habitGravado, ...over });
  mockHabitsRepository.update.mockImplementationOnce(
    async (_id: string, data: { scheduledDays: number[] }) => ({
      ...habitGravado,
      ...over,
      scheduledDays: data.scheduledDays,
    })
  );
}

/** Adultera o payload de um token mantendo a assinatura original. */
function adulterarPayload(token: string, mutar: (payload: Record<string, unknown>) => void): string {
  const [payloadB64, assinatura] = token.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
  mutar(payload);
  const novo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${novo}.${assinatura}`;
}

describe('INV-18 — a IA nunca executa: só o confirm aplica', () => {
  it('INV-18: propor não escreve nada', () => {
    service.sign(USER_ID, plan);

    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-18: confirmar com token válido aplica os dias propostos', async () => {
    const { token } = service.sign(USER_ID, plan);
    arrangeHabit();

    const resultado = await service.confirm(USER_ID, token);

    expect(resultado.scheduledDays).toEqual([1, 3]);
    expect(mockHabitsRepository.update).toHaveBeenCalledWith(HABIT_ID, {
      scheduledDays: [1, 3],
    });
  });

  it('INV-18: adversário — token com payload trocado e assinatura antiga é recusado', async () => {
    // O ataque óbvio: pegar uma proposta legítima e reescrever os dias. Sem HMAC,
    // isso seria um endpoint de escrita sem validação de domínio.
    const { token } = service.sign(USER_ID, plan);
    const adulterado = adulterarPayload(token, (payload) => {
      payload.proposedScheduledDays = [0, 1, 2, 3, 4, 5, 6];
    });

    await expect(service.confirm(USER_ID, adulterado)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Proposta inválida ou adulterada',
    });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-18: adversário — trocar o habitId no payload é recusado', async () => {
    const { token } = service.sign(USER_ID, plan);
    const adulterado = adulterarPayload(token, (payload) => {
      payload.habitId = 'habito-de-outra-pessoa';
    });

    await expect(service.confirm(USER_ID, adulterado)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockHabitsRepository.findById).not.toHaveBeenCalled();
  });

  it('INV-18: adversário — token forjado do zero é recusado', async () => {
    const forjado = `${Buffer.from(
      JSON.stringify({
        userId: USER_ID,
        habitId: HABIT_ID,
        currentScheduledDays: [1],
        proposedScheduledDays: [0, 1, 2, 3, 4, 5, 6],
        expiresAt: Date.now() + 60_000,
      })
    ).toString('base64url')}.${Buffer.from('assinatura-inventada').toString('base64url')}`;

    await expect(service.confirm(USER_ID, forjado)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-18: adversário — token sem assinatura é recusado', async () => {
    const { token } = service.sign(USER_ID, plan);
    const semAssinatura = token.split('.')[0]!;

    await expect(service.confirm(USER_ID, semAssinatura)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('INV-18: adversário — token vazio é recusado', async () => {
    await expect(service.confirm(USER_ID, '')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.confirm(USER_ID, '.')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('INV-18: adversário — proposta expirada é recusada', async () => {
    // Dez minutos de validade. Uma proposta que valesse para sempre viraria um
    // direito de escrita permanente, adquirido uma vez.
    const agora = Date.now();
    const { token } = service.sign(USER_ID, plan, agora);

    await expect(
      service.confirm(USER_ID, token, agora + 10 * 60 * 1000 + 1)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Proposta expirada. Peça uma nova sugestão.',
    });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-18: proposta dentro do prazo é aceita', async () => {
    const agora = Date.now();
    const { token } = service.sign(USER_ID, plan, agora);
    arrangeHabit();

    await expect(
      service.confirm(USER_ID, token, agora + 9 * 60 * 1000)
    ).resolves.toMatchObject({ scheduledDays: [1, 3] });
  });
});

describe('INV-19 — a proposta é sugestão, não autorização', () => {
  it('INV-19: adversário — token de outra pessoa não é aplicável, mesmo assinado', async () => {
    // O token é legítimo e a assinatura confere. O que barra é o userId dentro do
    // payload não bater com o do JWT de quem chamou.
    const { token } = service.sign(OTHER_USER_ID, plan);

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockHabitsRepository.findById).not.toHaveBeenCalled();
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-19: adversário — hábito apagado entre propor e confirmar responde 404', async () => {
    const { token } = service.sign(USER_ID, plan);
    mockHabitsRepository.findById.mockResolvedValueOnce(null);

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-19: adversário — hábito que trocou de dono entre propor e confirmar responde 403', async () => {
    const { token } = service.sign(USER_ID, plan);
    mockHabitsRepository.findById.mockResolvedValueOnce({
      ...habitGravado,
      userId: OTHER_USER_ID,
    });

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-07/INV-19: adversário — dias inválidos assinados pelo próprio serviço são recusados no confirm', async () => {
    // O motor nunca produziria isto, mas o confirm não pode depender disso: ele é
    // a última porta antes da escrita. O token abaixo é assinado de verdade.
    const { token } = service.sign(USER_ID, {
      ...plan,
      proposedScheduledDays: [1, 1, 9],
    });
    mockHabitsRepository.findById.mockResolvedValueOnce(habitGravado);

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Proposta com dias inválidos',
    });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-07/INV-19: adversário — conjunto vazio assinado é recusado', async () => {
    // Vazio significa "todo dia" no domínio: aplicar isso como alívio de rotina
    // faria o oposto do que a proposta diz.
    const { token } = service.sign(USER_ID, { ...plan, proposedScheduledDays: [] });
    mockHabitsRepository.findById.mockResolvedValueOnce(habitGravado);

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-19: os dias são gravados ordenados, independente da ordem do token', async () => {
    const { token } = service.sign(USER_ID, { ...plan, proposedScheduledDays: [5, 1, 3] });
    arrangeHabit();

    await service.confirm(USER_ID, token);

    expect(mockHabitsRepository.update).toHaveBeenCalledWith(HABIT_ID, {
      scheduledDays: [1, 3, 5],
    });
  });
});

describe('INV-19 — a proposta caduca se o agendamento mudar por outro caminho', () => {
  it('INV-19: adversário — agendamento editado à mão entre propor e confirmar responde 409', async () => {
    // O caso que `currentScheduledDays` existia para cobrir e não cobria: às 10h00
    // a proposta nasce para [1,3,5] → [1,3]; às 10h03 a pessoa edita à mão para
    // [0,6]; às 10h07 confirma, ainda no prazo. Sem esta checagem o hábito voltava
    // para [1,3] e a edição manual era apagada sem aviso.
    const { token } = service.sign(USER_ID, plan);
    mockHabitsRepository.findById.mockResolvedValueOnce({
      ...habitGravado,
      scheduledDays: [0, 6],
    });

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('mudou depois'),
    });
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });

  it('INV-19: 409 e não 400 — a proposta não é inválida, só ficou obsoleta', async () => {
    // A distinção importa para o cliente: 400 sugere pedido malformado e não deve
    // ser repetido; 409 diz "peça uma nova sugestão", que é a ação correta.
    const { token } = service.sign(USER_ID, plan);
    mockHabitsRepository.findById.mockResolvedValueOnce({
      ...habitGravado,
      scheduledDays: [2],
    });

    await expect(service.confirm(USER_ID, token)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('INV-19: mesma ordem diferente não é considerada mudança', async () => {
    // O banco pode devolver [5,1,3] onde a proposta gravou [1,3,5]. Comparar sem
    // ordenar transformaria ordem de coluna em conflito espúrio, e a pessoa não
    // conseguiria confirmar nunca.
    const { token } = service.sign(USER_ID, { ...plan, currentScheduledDays: [1, 3, 5] });
    arrangeHabit({ scheduledDays: [5, 1, 3] });

    await expect(service.confirm(USER_ID, token)).resolves.toMatchObject({
      scheduledDays: [1, 3],
    });
  });

  it('INV-19: adversário — o campo é lido de verdade, não só transportado', async () => {
    // Guarda contra regressão silenciosa: se alguém remover a comparação, este
    // caso volta a passar quando deveria falhar. Aqui o hábito mudou e a proposta
    // NÃO pode ser aplicada — se `update` for chamado, a checagem sumiu.
    const { token } = service.sign(USER_ID, plan);
    mockHabitsRepository.findById.mockResolvedValueOnce({
      ...habitGravado,
      scheduledDays: [],
    });

    await service.confirm(USER_ID, token).catch(() => undefined);
    expect(mockHabitsRepository.update).not.toHaveBeenCalled();
  });
});

describe('INV-18 — a chave de assinatura sobrevive a restart', () => {
  it('INV-18: um token assinado é verificável por outra instância do serviço', async () => {
    // A chave é derivada do JWT_SECRET por HKDF, não sorteada por processo. Duas
    // instâncias do serviço no mesmo ambiente têm de aceitar o token da outra —
    // sem isso a API não roda com mais de uma réplica, e a proposta morria a cada
    // restart.
    const outraInstancia = new ProposalService(mockHabitsRepository as never);
    const { token } = service.sign(USER_ID, plan);
    arrangeHabit();

    await expect(outraInstancia.confirm(USER_ID, token)).resolves.toMatchObject({
      scheduledDays: [1, 3],
    });
  });
});

describe('INV-18 — o motor decide os dias, não o modelo', () => {
  it('INV-18: buildProposals só devolve plano para hábito com sinal', () => {
    const report = {
      windowDays: 30,
      windowStart: '2026-07-24',
      windowEnd: '2026-08-22',
      habitCount: 2,
      overallCompletionRate: 60,
      habits: [
        // Aderência boa: nada a propor.
        habitAdherence({ habitId: 'ok', completionRate: 95, weakestWeekdays: [] }),
        // Sexta falhando: candidata a sair.
        habitAdherence({
          habitId: 'ruim',
          completionRate: 50,
          weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
          extrasByWeekday: [],
        }),
      ],
      strongest: null,
      weakest: null,
    };

    const planos = service.buildProposals(report);

    expect(planos.map((p) => p.habitId)).toEqual(['ruim']);
  });

  it('INV-18: o plano assinado carrega exatamente o que o motor decidiu', () => {
    const habit = habitAdherence({
      completionRate: 50,
      weakestWeekdays: [{ weekday: 5, scheduled: 4, missed: 4 }],
      extrasByWeekday: [],
    });
    const planoDoMotor = planReschedule(habit)!;
    const { token } = service.sign(USER_ID, planoDoMotor);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')
    ) as { proposedScheduledDays: number[] };

    expect(payload.proposedScheduledDays).toEqual(planoDoMotor.proposedScheduledDays);
    expect(payload.proposedScheduledDays).toEqual([1, 3]);
  });
});
