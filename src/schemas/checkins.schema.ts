import { z } from 'zod';

export const createCheckinSchema = z.object({
  date: z.string().datetime().optional(),
});

export const checkinDateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;
export type CheckinDateRangeInput = z.infer<typeof checkinDateRangeSchema>;
