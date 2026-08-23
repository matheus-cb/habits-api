-- Assistente conversacional: conversas, ações propostas e log de execução da IA.
--
-- ── Por que o histórico vive no servidor ──────────────────────────────────────
--
-- O histórico é o que o modelo recebe a cada volta. Se viesse do cliente, um
-- cliente modificado poderia reescrever "o que foi dito antes" e com isso o
-- contexto de uma decisão. Mesma razão de o `userId` vir do JWT (INV-10).
--
-- ── Por que `pending_actions` existe ──────────────────────────────────────────
--
-- É a fronteira do projeto em forma de tabela: o modelo produz a linha, e só um
-- ato explícito da pessoa a executa. Sem ela, "a decisão é do usuário" seria uma
-- promessa do prompt — e prompt não é garantia.
--
-- ── Por que `ai_calls` deixou de ser opcional ─────────────────────────────────
--
-- `createdVia = assistant` diz que a IA escreveu e não diz o que ela consultou,
-- quanto custou nem quantas voltas deu. Era ausência declarada em
-- `docs/PRIMITIVAS.md`, aceitável enquanto o cliente era o Claude Code (que tem
-- o próprio registro). Com chat próprio, um laço de ferramentas mal conduzido
-- gasta dinheiro real e ninguém saberia.
--
-- NÃO guarda prompt nem raciocínio do modelo (INV-16): contagem, duração,
-- modelo e resultado.

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('pending', 'approved', 'rejected', 'failed', 'expired');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "ordem" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "toolUseId" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "corpo" TEXT,
    "resumo" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'pending',
    "resultStatus" INTEGER,
    "resultBody" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_userId_updatedAt_idx" ON "conversations"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_ordem_idx" ON "conversation_messages"("conversationId", "ordem");

-- CreateIndex
CREATE INDEX "pending_actions_conversationId_status_idx" ON "pending_actions"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ai_calls_userId_createdAt_idx" ON "ai_calls"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Alcance da primitiva `query`: as quatro tabelas novas ─────────────────────
--
-- INV-29 obriga a decisão: tabela nova nasce INACESSÍVEL desde a migração
-- `grant_explicito`, e reprova o gate até alguém escrever aqui se é exposta.
--
-- As quatro são expostas, e o motivo é o mesmo do histórico de edição: "o que eu
-- pedi ao assistente na semana passada?" e "quanto isto está me custando?" são
-- perguntas que se quer fazer em linguagem natural. A política escopa pelo dono.
--
-- `conversation_messages` e `pending_actions` não têm `userId` próprio de
-- propósito — o dono é o da conversa. Duplicá-lo abriria a chance de divergir.
ALTER TABLE "conversations"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_actions"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_calls"              ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "conversations"         TO habits_readonly;
GRANT SELECT ON "conversation_messages" TO habits_readonly;
GRANT SELECT ON "pending_actions"       TO habits_readonly;
GRANT SELECT ON "ai_calls"              TO habits_readonly;

CREATE POLICY "leitura_das_proprias_conversas" ON "conversations"
  FOR SELECT TO habits_readonly
  USING ("userId" = current_setting('app.usuario_atual', true));

CREATE POLICY "leitura_das_proprias_mensagens" ON "conversation_messages"
  FOR SELECT TO habits_readonly
  USING (
    EXISTS (
      SELECT 1 FROM "conversations" c
      WHERE c."id" = "conversation_messages"."conversationId"
        AND c."userId" = current_setting('app.usuario_atual', true)
    )
  );

CREATE POLICY "leitura_das_proprias_acoes" ON "pending_actions"
  FOR SELECT TO habits_readonly
  USING (
    EXISTS (
      SELECT 1 FROM "conversations" c
      WHERE c."id" = "pending_actions"."conversationId"
        AND c."userId" = current_setting('app.usuario_atual', true)
    )
  );

CREATE POLICY "leitura_das_proprias_chamadas" ON "ai_calls"
  FOR SELECT TO habits_readonly
  USING ("userId" = current_setting('app.usuario_atual', true));
