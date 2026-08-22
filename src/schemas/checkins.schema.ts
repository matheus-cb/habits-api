import { z } from 'zod';

export const createCheckinSchema = z.object({
  date: z.string().datetime().optional(),
});

export const checkinDateRangeSchema = z
  .object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine((d) => (d.startDate == null) === (d.endDate == null), {
    message: 'startDate and endDate must be provided together',
  });

export const checkinParamSchema = z.object({
  habitId: z.string().uuid('Invalid habit ID'),
  id: z.string().uuid('Invalid checkin ID'),
});

export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;
export type CheckinDateRangeInput = z.infer<typeof checkinDateRangeSchema>;
export type CheckinParamInput = z.infer<typeof checkinParamSchema>;
