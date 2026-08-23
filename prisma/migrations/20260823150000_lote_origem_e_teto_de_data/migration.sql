-- Três correções vindas de revisão cruzada, todas sobre o mesmo tema: dado que
-- carrega duas responsabilidades, ou que não declara sua origem.

-- ── 1. Identidade de lote separada do fato temporal ──────────────────────────
--
-- O soft delete de hábito marcava os check-ins com o MESMO `deletedAt` e usava
-- esse timestamp como identidade do lote no restore. Duas responsabilidades numa
-- coluna, e a que não é natural dela é a que quebra:
--
--   14h30:00.000 — a pessoa desfaz um check-in de propósito
--   14h30:00.000 — um turno do assistente apaga o hábito
--
-- Mesmo timestamp, e o restore do hábito ressuscita o check-in que ela apagou —
-- exatamente a garantia que o lote existia para dar. Não precisa de colisão
-- rara: com um assistente emitindo chamadas em rajada, o mesmo milissegundo
-- deixa de ser improvável.
ALTER TABLE "habits"   ADD COLUMN "deleteBatchId" TEXT;
ALTER TABLE "checkins" ADD COLUMN "deleteBatchId" TEXT;
CREATE INDEX "checkins_deleteBatchId_idx" ON "checkins"("deleteBatchId");

-- ── 2. Origem do registro ────────────────────────────────────────────────────
--
-- O produto do Habits é o histórico ser EVIDÊNCIA. Com o assistente inserindo
-- check-ins, ninguém distingue o que a pessoa fez do que foi inserido por ela —
-- inclusive ela mesma, seis meses depois. Isso não é falha de segurança: é o dado
-- perdendo o significado que o torna útil.
--
-- Preenchido pelo SERVIDOR, nunca pelo corpo da requisição (INV-10). É o análogo
-- do `narration.source` da camada de IA: declarar quem produziu, para a resposta
-- não precisar ser confiada.
CREATE TYPE "CreatedVia" AS ENUM ('user', 'assistant');
ALTER TABLE "habits"   ADD COLUMN "createdVia" "CreatedVia" NOT NULL DEFAULT 'user';
ALTER TABLE "checkins" ADD COLUMN "createdVia" "CreatedVia" NOT NULL DEFAULT 'user';

-- As policies de RLS já cobrem as colunas novas: elas filtram por linha, não por
-- coluna. Nada a alterar ali.
