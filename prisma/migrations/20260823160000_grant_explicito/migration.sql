-- Fecha o default da leitura: grant por tabela, não `pg_read_all_data`.
--
-- A migração anterior deu `pg_read_all_data` à role somente-leitura, e isso
-- deixou as duas garantias da primitiva `query` **assimétricas**:
--
--   leitura → global e opt-out (toda tabela de todo schema, presente e futura)
--   escopo  → por tabela e opt-in (três políticas, escritas à mão)
--
-- Hoje a assimetria é inofensiva: a única tabela extra é `_prisma_migrations`.
-- Amanhã não, e a tabela que abre o buraco já está nomeada em
-- `docs/PRIMITIVAS.md` como trabalho seguinte — o log de execução da IA, com
-- prompts, respostas e custos de todos os usuários. Criada por migração, ela
-- nasceria legível por inteiro pela primitiva, sem RLS, sem aviso, e sem nenhum
-- teste falhando.
--
-- É a forma exata de INV-26 aplicada ao banco em vez de às rotas, e a correção é
-- a mesma: o default passa a ser **negar**, e quem quiser uma tabela exposta
-- escreve o grant e a política no mesmo commit. INV-29 é o gate que obriga a
-- decisão, como INV-26 obriga a das rotas.
REVOKE pg_read_all_data FROM habits_readonly;

GRANT SELECT ON "users" TO habits_readonly;
GRANT SELECT ON "habits" TO habits_readonly;
GRANT SELECT ON "checkins" TO habits_readonly;

-- Sem isto, `ALTER TABLE ... OWNER` ou uma recriação de tabela poderia devolver o
-- default permissivo por outro caminho. `ALTER DEFAULT PRIVILEGES` é o que
-- garante que tabela FUTURA criada pelo dono não venha com SELECT para esta role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM habits_readonly;
