import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3333'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * IA — inteiramente opcional. Sem chave, a camada de insights continua
   * respondendo pelo redator determinístico e o resto da API não muda em nada.
   * É por isso que estas três não têm `.min()` nem são obrigatórias: torná-las
   * obrigatórias transformaria a IA em dependência de inicialização, exatamente
   * o oposto do que a fronteira exige.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /** Teto de saída da redação. Resumo é texto curto; não precisa de mais. */
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(1024),
  /** Timeout do provedor, em ms. Estourar cai no redator determinístico. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;

/** Se há provedor de IA configurado. Único lugar que decide isso. */
export const aiConfigured = (): boolean => Boolean(env.ANTHROPIC_API_KEY?.trim());
