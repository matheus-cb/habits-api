-- Retenção de `ai_calls`, e por que só dela.
--
-- Eu havia declarado três tabelas sem política de descarte — `habit_revisions`,
-- `conversation_messages` e `ai_calls` — como se fossem o mesmo problema repetido.
-- Não são, e a distinção é do peer:
--
--   `habit_revisions` e `conversation_messages` guardam CONTEÚDO que a pessoa pode
--   querer daqui a um ano, e descartar por idade apaga exatamente o que se quer
--   recuperar de um erro antigo. Foi o meu argumento original, e ele vale ali.
--
--   `ai_calls` é o inverso em três eixos: o valor DECAI (custo de ontem orienta
--   decisão, custo de março é curiosidade), o volume cresce com USO e não com
--   edição, e nada nela é recuperável — é telemetria.
--
-- Retenção por idade é a política certa aqui, e era errada lá. "Três tabelas sem
-- retenção" era um problema declarado três vezes; são dois problemas diferentes.
--
-- ## Por que o agregado mensal fica
--
-- Descartar sem agregar responderia "quanto gastei ontem?" e perderia "meu gasto
-- está subindo ao longo dos meses?" — que é a pergunta que justifica guardar
-- custo. O agregado é uma linha por mês por usuário por motor, e não cresce com
-- uso.
CREATE TABLE "ai_usage_monthly" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- Primeiro dia do mês, em UTC. Mesma razão de INV-04: o dia é resolvido em
    -- UTC em todo lugar, e um agregado que virasse à meia-noite local discordaria
    -- do resto por três horas por dia.
    "month" DATE NOT NULL,
    "engine" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_monthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_monthly_userId_month_engine_key"
  ON "ai_usage_monthly"("userId", "month", "engine");

ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alcance da primitiva `query`: exposta, com RLS pelo dono. INV-29 obriga a
-- decisão, e esta é a tabela que responde "quanto isto está me custando ao longo
-- do tempo?" — a pergunta que se quer fazer em linguagem natural.
ALTER TABLE "ai_usage_monthly" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "ai_usage_monthly" TO habits_readonly;

CREATE POLICY "leitura_do_proprio_consumo" ON "ai_usage_monthly"
  FOR SELECT TO habits_readonly
  USING ("userId" = current_setting('app.usuario_atual', true));
