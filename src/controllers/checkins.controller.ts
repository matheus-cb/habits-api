import { Request, Response } from 'express';
import { CheckinsService } from '@/services/checkins.service';
import { StatsService } from '@/services/stats.service';
import { CheckinsRepository } from '@/repositories/checkins.repository';
import { HabitsRepository } from '@/repositories/habits.repository';
import { successResponse } from '@/utils/response';
import { CreateCheckinInput } from '@/schemas/checkins.schema';

export class CheckinsController {
  private checkinsService: CheckinsService;
  private statsService: StatsService;

  constructor() {
    const checkinsRepository = new CheckinsRepository();
    const habitsRepository = new HabitsRepository();
    this.checkinsService = new CheckinsService(checkinsRepository, habitsRepository);
    this.statsService = new StatsService(checkinsRepository, habitsRepository);
  }

  create = async (
    req: Request<{ habitId: string }, object, CreateCheckinInput>,
    res: Response
  ) => {
    const userId = req.user!.id;
    const { habitId } = req.params;
    const { date } = req.body;

    const result = await this.checkinsService.createCheckin(
      habitId,
      userId,
      date ? new Date(date) : undefined
    );

    return res.status(201).json(successResponse(result, 'Check-in created successfully'));
  };

  getByHabit = async (req: Request<{ habitId: string }>, res: Response) => {
    const userId = req.user!.id;
    const { habitId } = req.params;
    const result = await this.checkinsService.getCheckinsByHabit(habitId, userId);
    return res.status(200).json(successResponse(result));
  };

  getStats = async (req: Request<{ habitId: string }>, res: Response) => {
    const userId = req.user!.id;
    const { habitId } = req.params;
    const result = await this.statsService.getHabitStats(habitId, userId);
    return res.status(200).json(successResponse(result));
  };

  delete = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params;
    await this.checkinsService.deleteCheckin(id, userId);
    return res.status(204).send();
  };
}
