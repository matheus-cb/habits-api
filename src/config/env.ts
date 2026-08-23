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

  /**
   * Teto de tokens de SAÍDA por usuário por dia no assistente.
   *
   * Não é preferência: é a diferença entre uma conversa e uma conta imprevisível.
   * O laço de ferramentas dá várias voltas por mensagem, e um modelo que decide
   * consultar dez vezes gasta dez vezes. Sem teto, o custo é ilimitado por
   * construção — e quem paga não é quem conversa.
   *
   * Saída e não entrada porque saída custa cinco vezes mais e é a que o laço
   * multiplica.
   */
  ASSISTANT_DAILY_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).default(120_000),

  /**
   * Máximo de voltas do laço por mensagem.
   *
   * O laço termina quando o modelo para de pedir ferramenta. Um modelo confuso
   * pode não parar — consultar, achar estranho, consultar de novo. Este teto é o
   * que garante que a mensagem termina, e ele é atingido em silêncio hoje: o
   * assistente responde com o que tem e diz que parou.
   */
  ASSISTANT_MAX_TURNS: z.coerce.number().int().min(1).max(24).default(10),

  /** Prazo de uma ação proposta. Passado isso, aprovar é recusado. */
  ASSISTANT_ACTION_TTL_MINUTES: z.coerce.number().int().min(1).default(30),
  /** Timeout do provedor, em ms. Estourar cai no redator determinístico. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

  /**
   * Conexão da role `habits_readonly`, usada só pela primitiva `query` do MCP.
   *
   * Opcional pelo mesmo motivo que a chave de IA é: ausente, a primitiva não é
   * registrada e todo o resto funciona igual. E é uma URL SEPARADA de propósito
   * — reusar a da aplicação daria à primitiva os privilégios de escrita do dono
   * das tabelas, que também contorna RLS. As duas garantias cairiam juntas.
   */
  DATABASE_URL_READONLY: z.string().url().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;

/** Se há provedor de IA configurado. Único lugar que decide isso. */
export const aiConfigured = (): boolean => Boolean(env.ANTHROPIC_API_KEY?.trim());
