import { z } from 'zod/v4';

/**
 * Data de check-in não pode ser no futuro.
 *
 * Faltava, e com escrita manual era erro de digitação. Com um assistente
 * compondo chamadas é vetor de falsificação: 365 inserts retroativos criam um
 * ano de aderência que nunca aconteceu, e cada um é individualmente válido.
 *
 * O teto é o dia UTC, o mesmo que INV-04 usa para resolver o dia — comparar com
 * "agora" local reprovaria check-in legítimo de quem está à frente de UTC.
 */
export const createCheckinSchema = z.object({
  date: z
    .string()
    .datetime()
    .refine(
      (valor) => {
        const dia = new Date(valor);
        const hoje = new Date();
        const limite = Date.UTC(
          hoje.getUTCFullYear(),
          hoje.getUTCMonth(),
          hoje.getUTCDate(),
          23,
          59,
          59,
          999
        );
        return dia.getTime() <= limite;
      },
      { message: 'Não é possível marcar check-in em data futura' }
    )
    .optional(),
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
