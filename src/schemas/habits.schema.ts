import { z } from 'zod';

const scheduledDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .optional();

export const createHabitSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().max(500).optional(),
  scheduledDays: scheduledDaysSchema,
});

export const updateHabitSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  scheduledDays: scheduledDaysSchema,
});

export const habitIdSchema = z.object({
  id: z.string().uuid('Invalid habit ID'),
});

export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;
