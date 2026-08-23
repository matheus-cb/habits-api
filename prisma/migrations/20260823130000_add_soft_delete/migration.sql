-- Soft delete em habits e checkins.
--
-- Motivo: apagar um hábito destruía todo o histórico de check-ins por cascade, e
-- o histórico é o valor inteiro do app. O caminho alcançável por assistente
-- passa a ser lógico e reversível; o delete físico vira um script local, fora do
-- HTTP, para nenhum allowlist poder expô-lo por engano.

ALTER TABLE "habits"   ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "checkins" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "habits_userId_deletedAt_idx"    ON "habits"("userId", "deletedAt");
CREATE INDEX "checkins_habitId_deletedAt_idx" ON "checkins"("habitId", "deletedAt");

-- A unicidade passa a valer só entre os check-ins ATIVOS.
--
-- O `@@unique([habitId, date])` original criava `checkins_habitId_date_key`
-- cobrindo toda a tabela. Com soft delete isso quebra o fluxo mais comum do app:
-- marcar → desfazer → marcar de novo no mesmo dia falharia com 409 contra uma
-- linha que o usuário não vê mais.
--
-- O índice parcial preserva o sentido de INV-01 e o estreita para "um check-in
-- ATIVO por hábito por dia". A garantia continua sendo do banco, não da consulta
-- prévia no service — é o índice que impede a duplicata sob concorrência.
--
-- O Prisma não declara índice parcial no schema, então ele vive aqui e o
-- `@@unique` foi removido do modelo de propósito. `prisma migrate diff` compara
-- migrações com o schema, e deixar o `@@unique` lá acusaria drift para sempre.
DROP INDEX "checkins_habitId_date_key";
CREATE UNIQUE INDEX "checkins_habitId_date_ativo_key"
  ON "checkins"("habitId", "date")
  WHERE "deletedAt" IS NULL;
