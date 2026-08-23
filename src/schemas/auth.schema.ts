// `zod/v4`, e não `zod`. Os schemas desta pasta são a definição de contrato do
// projeto, e é deles que o recurso `habits://contratos` do MCP é DERIVADO, via
// `z.toJSONSchema()` — que só existe na v4. A alternativa era manter o contrato
// escrito à mão num objeto OpenAPI paralelo, que foi exatamente o que apodreceu:
// o `swaggerDocument` tinha `paths: {}` e ninguém tinha percebido.
//
// `zod@3.25` publica as duas implementações no mesmo pacote. `src/config/env.ts`
// segue na v3 de propósito: ele valida antes de qualquer contrato existir.
import { z } from 'zod/v4';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(100, 'Password too long'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
    email: z.string().email('Invalid email format').optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'At least one field must be provided',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
