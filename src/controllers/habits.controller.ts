import { Request, Response } from 'express';
import { HabitsService } from '@/services/habits.service';
import { HabitsRepository } from '@/repositories/habits.repository';
import { successResponse } from '@/utils/response';
import { CreateHabitInput, UpdateHabitInput } from '@/schemas/habits.schema';
import { origemDaRequisicao } from '@/mcp/origem';

export class HabitsController {
  private habitsService: HabitsService;

  constructor() {
    const habitsRepository = new HabitsRepository();
    this.habitsService = new HabitsService(habitsRepository);
  }

  getAll = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await this.habitsService.getAllHabits(userId);
    return res.status(200).json(successResponse(result));
  };

  getById = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const result = await this.habitsService.getHabitById(id, userId);
    return res.status(200).json(successResponse(result));
  };

  create = async (req: Request<object, object, CreateHabitInput>, res: Response) => {
    const userId = req.user!.id;
    const result = await this.habitsService.createHabit(userId, req.body, origemDaRequisicao(req));
    return res.status(201).json(successResponse(result, 'Habit created successfully'));
  };

  update = async (req: Request<{ id: string }, object, UpdateHabitInput>, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const result = await this.habitsService.updateHabit(id, userId, req.body);
    return res.status(200).json(successResponse(result, 'Habit updated successfully'));
  };

  restore = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const result = await this.habitsService.restoreHabit(id, userId);
    return res.status(200).json(successResponse(result, 'Hábito restaurado'));
  };

  delete = async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params;
    await this.habitsService.deleteHabit(id, userId);
    return res.status(204).send();
  };
}
