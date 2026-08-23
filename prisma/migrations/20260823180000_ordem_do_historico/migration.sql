-- Ordem determinística do histórico.
--
-- `replacedAt` é `TIMESTAMP(3)`, então duas edições no mesmo milissegundo
-- produzem duas revisões com o MESMO valor — e "a mais recente" passa a ser o que
-- o Postgres decidir devolver primeiro.
--
-- É o `deletedAt`-como-marcador-de-lote outra vez, na tabela nova, e aqui é pior:
-- o lote era lido por IGUALDADE e o histórico é lido por ORDEM. Um empate de
-- timestamp não perde dado — perde a sequência, e uma sequência com dois eventos
-- trocados **parece completa**. É a mesma propriedade que tornou "histórico com
-- uma linha a mais" pior que "sem a linha".
--
-- E não é hipotético: um assistente compondo chamadas em rajada tira "mesmo
-- milissegundo" do improvável, que foi o argumento que trocou o marcador de lote
-- por `deleteBatchId`.
--
-- `BIGSERIAL` em vez de ordenar por `(replacedAt DESC, id DESC)`: o id é um uuid
-- v4, então a ordem por id é aleatória — determinística, sim, e mentindo sobre
-- cronologia exatamente quando o empate acontece. A sequência é monotônica de
-- verdade.
ALTER TABLE "habit_revisions" ADD COLUMN "ordem" BIGSERIAL NOT NULL;

-- O índice de leitura passa a ser por `ordem`. O antigo continua servindo consulta
-- por janela de tempo ("o que mudou desde março?"), que é caso da primitiva
-- `query` e não da rota.
CREATE INDEX "habit_revisions_habitId_ordem_idx" ON "habit_revisions"("habitId", "ordem" DESC);
