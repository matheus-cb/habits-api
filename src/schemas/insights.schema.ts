import { z } from 'zod/v4';

/**
 * O token é opaco por fora: `payload.assinatura`, ambos base64url. O schema
 * valida forma, não conteúdo — quem valida conteúdo é o HMAC no
 * `ProposalService`, e é lá que essa checagem tem de estar (INV-18).
 */
export const confirmProposalSchema = z.object({
  token: z
    .string()
    .min(16)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Formato de proposta inválido'),
});

export type ConfirmProposalInput = z.infer<typeof confirmProposalSchema>;
