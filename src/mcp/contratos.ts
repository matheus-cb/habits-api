// `zod/v4` porque `toJSONSchema` só existe nela — e é por isso que os schemas
// de `src/schemas/` foram migrados.
import { z } from 'zod/v4';
import { createHabitSchema, updateHabitSchema } from '@/schemas/habits.schema';
import { createCheckinSchema } from '@/schemas/checkins.schema';
import { confirmProposalSchema } from '@/schemas/insights.schema';

/**
 * O contrato de corpo de cada rota de escrita, **derivado** dos schemas Zod.
 *
 * Este é o par do `habits://rotas`: a allowlist diz o que pode ser chamado, isto
 * diz o que mandar. E os dois vêm de onde a garantia mora — a lista, da constante
 * que o gateway confere; o contrato, do schema que o middleware executa.
 *
 * Escrever isto à mão era a alternativa óbvia, e é exatamente o que já falhou:
 * o `swaggerDocument` deste repositório tem `paths: {}` desde sempre, servido em
 * `/api-docs` como se descrevesse a API. Um contrato escrito à mão não avisa
 * quando fica errado; um derivado não pode ficar errado.
 *
 * A consequência prática: campo novo num schema aparece aqui sem código novo, e
 * campo removido desaparece. O teste confere que os quatro contratos existem e
 * que cada um traz as propriedades que a rota realmente exige.
 */
export function contratosDeEscrita(): Record<string, unknown> {
  const converter = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' });

  return {
    'POST /api/v1/habits': converter(createHabitSchema),
    'PUT /api/v1/habits/:id': converter(updateHabitSchema),
    'POST /api/v1/habits/:habitId/checkin': converter(createCheckinSchema),
    'POST /api/v1/insights/reschedule-proposals/confirm': converter(confirmProposalSchema),
  };
}
