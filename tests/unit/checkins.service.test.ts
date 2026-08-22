import { CheckinsService } from '@/services/checkins.service';
import { toDayKey } from '@/utils/helpers';

const mockCheckinsRepository = {
  findByHabitId: jest.fn(),
  findById: jest.fn(),
  findByHabitIdAndDate: jest.fn(),
  findByHabitIdAndDateRange: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
};

const mockHabitsRepository = { findById: jest.fn() };

const service = new CheckinsService(
  mockCheckinsRepository as never,
  mockHabitsRepository as never
);

const HABIT_ID = 'habit-1';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

const habit = {
  id: HABIT_ID,
  userId: USER_ID,
  title: 'Ler',
  description: null,
  scheduledDays: [1] as number[],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date(),
};

/** Erro no formato que o Prisma lança em violação de constraint única. */
function erroDeConstraintUnica() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

describe('INV-03 — check-in só é criado pelo dono do hábito', () => {
  it('INV-03: hábito inexistente responde 404', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce(null);

    await expect(service.createCheckin(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCheckinsRepository.create).not.toHaveBeenCalled();
  });

  it('INV-03: adversário — marcar check-in em hábito de outra pessoa responde 403 e não grava', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce({ ...habit, userId: OTHER_USER_ID });

    await expect(service.createCheckin(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCheckinsRepository.create).not.toHaveBeenCalled();
  });

  it('INV-03: adversário — apagar check-in de hábito de outra pessoa responde 403 e não apaga', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce({ ...habit, userId: OTHER_USER_ID });

    await expect(service.deleteCheckin('c1', HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCheckinsRepository.delete).not.toHaveBeenCalled();
  });

  it('INV-03: adversário — check-in de outro hábito não é apagável pela rota deste', async () => {
    // O id do check-in pertence a outro hábito. Sem a checagem `checkin.habitId
    // !== habitId`, saber um id bastaria para apagar registro alheio.
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findById.mockResolvedValueOnce({ id: 'c1', habitId: 'outro-habito' });

    await expect(service.deleteCheckin('c1', HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCheckinsRepository.delete).not.toHaveBeenCalled();
  });
});

describe('INV-04 — o dia gravado é o dia UTC', () => {
  it('INV-04: data com hora é truncada para meia-noite UTC antes de gravar', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockResolvedValueOnce({ id: 'c1' });

    await service.createCheckin(HABIT_ID, USER_ID, new Date('2026-06-15T18:42:11.000Z'));

    const gravado = mockCheckinsRepository.create.mock.calls[0]?.[0] as { date: Date };
    expect(gravado.date.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('INV-04: adversário — 23:59 UTC não é gravado como o dia seguinte', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockResolvedValueOnce({ id: 'c1' });

    await service.createCheckin(HABIT_ID, USER_ID, new Date('2026-06-15T23:59:59.999Z'));

    const gravado = mockCheckinsRepository.create.mock.calls[0]?.[0] as { date: Date };
    expect(toDayKey(gravado.date)).toBe('2026-06-15');
  });

  it('INV-04: a consulta de duplicata usa o mesmo dia truncado da gravação', async () => {
    // Se a consulta usasse a data com hora e a gravação o dia truncado, a
    // duplicata nunca seria encontrada e o 409 dependeria da constraint.
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockResolvedValueOnce({ id: 'c1' });

    await service.createCheckin(HABIT_ID, USER_ID, new Date('2026-06-15T18:42:11.000Z'));

    const consultado = mockCheckinsRepository.findByHabitIdAndDate.mock.calls[0]?.[1] as Date;
    const gravado = (mockCheckinsRepository.create.mock.calls[0]?.[0] as { date: Date }).date;
    expect(consultado.toISOString()).toBe(gravado.toISOString());
  });
});

describe('INV-05 — duplicata responde 409, inclusive quando quem barra é a constraint', () => {
  it('INV-05: check-in já existente no dia responde 409', async () => {
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce({ id: 'existente' });

    await expect(service.createCheckin(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Check-in already exists for this date',
    });
    expect(mockCheckinsRepository.create).not.toHaveBeenCalled();
  });

  it('INV-01/INV-05: adversário — corrida perdida na constraint também responde 409, não 500', async () => {
    // Dois pedidos simultâneos passam os dois pela consulta prévia. O perdedor
    // recebe P2002 do banco. Sem a tradução, o vencedor recebia 201 e o perdedor
    // 500 — mesmo caso de negócio, resposta diferente por acidente de tempo.
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockRejectedValueOnce(erroDeConstraintUnica());

    await expect(service.createCheckin(HABIT_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Check-in already exists for this date',
    });
  });

  it('INV-05: adversário — erro de banco que não é P2002 continua subindo, não vira 409', async () => {
    // Traduzir qualquer falha de escrita em 409 esconderia indisponibilidade do
    // banco atrás de "já existe check-in".
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), { code: 'P1001' })
    );

    await expect(service.createCheckin(HABIT_ID, USER_ID)).rejects.toMatchObject({
      message: 'connection refused',
    });
  });
});

describe('INV-08 — check-in em dia não agendado é aceito', () => {
  it('INV-08: hábito agendado só na segunda aceita check-in em outro dia', async () => {
    // Uma terça-feira. O hábito é de segundas. Recusar seria transformar
    // "fazer a mais" em erro.
    mockHabitsRepository.findById.mockResolvedValueOnce(habit);
    mockCheckinsRepository.findByHabitIdAndDate.mockResolvedValueOnce(null);
    mockCheckinsRepository.create.mockResolvedValueOnce({ id: 'c1' });

    await expect(
      service.createCheckin(HABIT_ID, USER_ID, new Date('2026-06-16T10:00:00.000Z'))
    ).resolves.toEqual({ id: 'c1' });
    expect(mockCheckinsRepository.create).toHaveBeenCalled();
  });
});
