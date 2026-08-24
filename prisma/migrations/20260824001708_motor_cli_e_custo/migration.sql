-- Sessão do CLI do Claude Code, e custo em dólares.
--
-- `cliSessionId` guarda o fio da conversa: com `--resume`, o CLI já tem o
-- histórico e o servidor não reenvia nada. Medido — uma pergunta de acompanhamento
-- é respondida certo sem contexto do nosso lado.
--
-- Ela NÃO barateia. Retomar mediu MAIS caro que abrir nova ($0.25 → $0.33): o
-- custo é por volta de ferramenta, e cada volta relê os ~32k tokens de contexto do
-- próprio CLI. A hipótese de que sessão persistida reduziria custo estava errada, e
-- fica registrada aqui porque é a primeira coisa que alguém vai supor de novo.
--
-- `costUsd` é DECIMAL e não FLOAT: somar centavos em ponto flutuante acumula erro,
-- e esta coluna existe para virar um total que a pessoa lê.

-- AlterTable
ALTER TABLE "ai_calls" ADD COLUMN     "costUsd" DECIMAL(12,6),
ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'api';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "cliSessionId" TEXT;
