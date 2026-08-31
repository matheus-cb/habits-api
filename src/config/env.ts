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
   * Se `POST /auth/register` aceita criar conta (INV-42).
   *
   * O default é `fechado`, e a escolha do default é o ponto. Enquanto a API
   * rodava só nesta máquina, registro aberto era inofensivo; publicada, a conta
   * é de quem souber a URL e o custo do assistente é de quem hospeda — e o teto
   * de custo é POR USUÁRIO (INV-36), então cada conta nova multiplica o gasto.
   *
   * Fechado por default e não aberto-com-fechamento-explícito porque as duas
   * falhas não são simétricas: esquecer a variável em produção deixaria a porta
   * aberta sem nada acusando, enquanto esquecê-la em desenvolvimento produz um
   * 403 imediato e legível. É a mesma escolha do INV-27 — falha fechada.
   *
   * O preço está declarado: um clone novo, sem `.env`, sobe com o registro
   * fechado e o `scripts/smoke.sh` local reprova no primeiro request. Por isso
   * `.env.example` e `.env.test` trazem `aberto`, e o job `smoke` do CI o
   * declara no ambiente.
   *
   * Enum e não booleano porque `env.ts` não tem precedente de booleano — os
   * ligáveis existentes são variáveis opcionais cuja ausência desliga o recurso,
   * e aqui a ausência precisa LIGAR a proteção, não desligá-la.
   */
  REGISTRO: z.enum(['aberto', 'fechado']).default('fechado'),

  /**
   * IA — inteiramente opcional. Sem chave, a camada de insights continua
   * respondendo pelo redator determinístico e o resto da API não muda em nada.
   * É por isso que estas três não têm `.min()` nem são obrigatórias: torná-las
   * obrigatórias transformaria a IA em dependência de inicialização, exatamente
   * o oposto do que a fronteira exige.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  /**
   * Modelo da REDAÇÃO — o resumo de aderência e a justificativa das propostas.
   *
   * Opus porque é um parágrafo por chamada, uma vez por visita à tela de
   * insights: a qualidade do texto importa e o custo é irrelevante nesse volume.
   */
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  /**
   * Modelo do ASSISTENTE conversacional, e por que ele é diferente do da redação.
   *
   * Sonnet, e a escolha é medida. Mesma pergunta, mesmo prompt, mesmo número de
   * voltas:
   *
   *   opus    4 voltas   315 tokens de saída   $0.1661   9.5s
   *   sonnet  4 voltas   318 tokens de saída   $0.0882   8.2s
   *   haiku  11 voltas  1528 tokens de saída   $0.1232  27.1s
   *
   * Sonnet custa **47% menos** que Opus e responde igual. E Haiku é pior nos dois
   * eixos — não por ser mais barato por token, mas porque **erra e tenta de novo**:
   * onze voltas, e cada volta relê o contexto inteiro. O modelo mais barato por
   * token sendo o mais caro por resposta é o resultado que contraria a intuição, e
   * é por isso que a escolha está medida em vez de suposta.
   *
   * Vale para os DOIS motores: `--model` no subprocesso do CLI, e `model` na
   * chamada do SDK. Um assistente que respondesse diferente dependendo do motor
   * seria dois assistentes.
   */
  ASSISTANT_MODEL: z.string().default('claude-sonnet-5'),

  /**
   * Dias de retenção de `ai_calls`.
   *
   * Só desta tabela: `habit_revisions` e `conversation_messages` guardam conteúdo
   * que a pessoa pode querer daqui a um ano, e descartar por idade lá apaga
   * exatamente o que se quer recuperar. `ai_calls` é telemetria — o valor decai, o
   * volume cresce com uso, e nada nela é recuperável.
   *
   * 90 dias porque é o horizonte em que custo ainda orienta decisão. Além disso, o
   * agregado mensal em `ai_usage_monthly` responde a pergunta que sobra: "meu
   * gasto está subindo?".
   */
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(7).default(90),
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

  /**
   * Caminho do executável `claude`, para o motor que roda na assinatura do
   * Claude Code em vez de numa chave da API.
   *
   * Opcional: sem ele, o assistente usa a `ANTHROPIC_API_KEY`. Sem nenhum dos
   * dois, o chat recusa com o motivo e o resto do app segue (INV-15).
   *
   * Caminho absoluto e não "claude" no `PATH`: o subprocesso roda com ambiente
   * reduzido de propósito, e depender do `PATH` faria o motor funcionar no
   * terminal e falhar no serviço, pelo mesmo tipo de divergência de ambiente que
   * esta safra catalogou cinco vezes.
   */
  CLAUDE_CLI_PATH: z.string().optional(),

  /**
   * Ponte privada que alcança o Claude Code autenticado no host.
   *
   * O container não recebe o binário, o HOME nem a credencial do Claude Code.
   * Ele só conversa com uma ponte HTTP ligada ao gateway privado do Docker. As
   * duas variáveis são opcionais para que o restante da aplicação continue
   * inicializando sem assistente (INV-15).
   */
  CLAUDE_BRIDGE_BASE_URL: z.string().url().optional().or(z.literal('')),
  CLAUDE_BRIDGE_SECRET: z.string().min(32).optional().or(z.literal('')),
  ASSISTANT_BRIDGE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),

  /**
   * Teto de tempo do subprocesso.
   *
   * Medido: 9 a 46 segundos por pergunta, dependendo de quantas voltas de
   * ferramenta o modelo dá. 120s dá folga para o pior caso observado sem deixar um
   * processo pendurado indefinidamente segurando uma requisição HTTP.
   */
  ASSISTANT_CLI_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),

  /**
   * Teto diário de CUSTO, em dólares, por usuário — para o motor CLI.
   *
   * Existe porque o teto de tokens não serve aqui: o CLI cobra por volta de
   * ferramenta relendo o contexto, e uma pergunta de 280 tokens de saída custou
   * $0.16. Contar saída mediria a coisa errada por uma ordem de grandeza.
   *
   * 3 dólares por dia por pessoa dá cerca de 18 perguntas ao preço medido. Para
   * duas ou três contas de uso próprio é folgado; se doer, é este número que muda.
   */
  ASSISTANT_DAILY_COST_USD: z.coerce.number().min(0.1).default(3),
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

/** Se a criação de conta por HTTP está liberada. Único lugar que decide isso. */
export const registroAberto = (): boolean => env.REGISTRO === 'aberto';
