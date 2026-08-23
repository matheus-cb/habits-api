-- Histórico de edição: fecha a única promessa do objetivo que não se cumpria.
--
-- O `AGENTS.md` abre dizendo que a prioridade é registro "exato e recuperável".
-- Até aqui recuperável valia para exclusão (soft delete, `deleteBatchId`,
-- `/restore`) e NÃO valia para edição: `PUT /habits/:id` e o confirm do
-- reagendamento sobrescreviam e o valor anterior deixava de existir.
--
-- A assimetria é do domínio, não da camada de IA — mas as primitivas do MCP a
-- tornaram alcançável por composição, e é isso que a promove de dívida a defeito:
-- um assistente podia reescrever o título de um hábito de três anos sem deixar
-- rastro, e a anotação `destructiveHint` da tool `request` tinha de ser `true`
-- por causa dessas duas rotas.
CREATE TABLE "habit_revisions" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedVia" "CreatedVia" NOT NULL DEFAULT 'user',

    CONSTRAINT "habit_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "habit_revisions_habitId_replacedAt_idx" ON "habit_revisions"("habitId", "replacedAt");

-- `CASCADE` e não `RESTRICT`: o purge físico de um hábito tem de levar as
-- revisões dele. Revisão órfã seria histórico de um registro que não existe.
ALTER TABLE "habit_revisions" ADD CONSTRAINT "habit_revisions_habitId_fkey"
  FOREIGN KEY ("habitId") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Alcance da primitiva `query`: grant explícito e política ──────────────────
--
-- Sem estas quatro linhas a tabela nasceria INACESSÍVEL, e é isso que a migração
-- `grant_explicito` garantiu. INV-29 é o gate que obriga a decisão: uma tabela
-- nova reprova o teste até alguém escrever aqui que ela é exposta — e escrever a
-- política no mesmo lugar.
--
-- Ela é exposta porque histórico de edição é exatamente o tipo de coisa que se
-- quer perguntar em linguagem natural ("o que mudou neste hábito desde março?"),
-- e a política a escopa pelo dono do hábito, não pela linha em si — revisão não
-- tem `userId` próprio de propósito: duplicá-lo abriria a chance de divergir do
-- dono do hábito.
ALTER TABLE "habit_revisions" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "habit_revisions" TO habits_readonly;

CREATE POLICY "leitura_das_proprias_revisoes" ON "habit_revisions"
  FOR SELECT TO habits_readonly
  USING (
    EXISTS (
      SELECT 1 FROM "habits" h
      WHERE h."id" = "habit_revisions"."habitId"
        AND h."userId" = current_setting('app.usuario_atual', true)
    )
  );
