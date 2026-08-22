import { z } from 'zod';

/**
 * Dias da semana em que o hábito é cobrado: 0 = domingo … 6 = sábado, a mesma
 * convenção de `Date.getUTCDay()`.
 *
 * Array vazio (o default do schema) significa "todo dia". O `.max(7)` e a
 * checagem de repetição existem porque, sem elas, `[1,1,1,1,1,1,1,1]` era aceito
 * e ia para o banco: a validação de faixa por elemento não diz nada sobre o
 * conjunto. Um conjunto sujo distorce silenciosamente a taxa de aderência, que é
 * calculada sobre a contagem de dias agendados.
 */
const scheduledDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7, 'scheduledDays cannot have more than 7 entries')
  .refine((days) => new Set(days).size === days.length, {
    message: 'scheduledDays cannot repeat a weekday',
  })
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
