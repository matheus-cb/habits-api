-- Renomeia a variável de sessão do RLS: `app.current_user` → `app.usuario_atual`.
--
-- `current_user` é PALAVRA RESERVADA no Postgres. `SET LOCAL app.current_user = '…'`
-- não chega a executar — falha no parser com "syntax error at or near
-- current_user", porque o parser lê o `current_user` como a função embutida em vez
-- de como a segunda parte do nome do parâmetro.
--
-- A migração anterior criou as políticas com esse nome e elas ficaram
-- permanentemente fechadas: `current_setting(…, true)` devolvia NULL, NULL não
-- casa com nada, e a role via zero linhas sempre. Falha fechada, então nada
-- vazou — mas a primitiva `query` seria inútil.
--
-- Corrigido por migração nova em vez de edição da anterior: as duas já estavam
-- aplicadas em dois bancos, e migração é append-only. O registro do motivo vale
-- mais que o histórico limpo.

DROP POLICY IF EXISTS "leitura_do_proprio_usuario"    ON "users";
DROP POLICY IF EXISTS "leitura_dos_proprios_habitos"  ON "habits";
DROP POLICY IF EXISTS "leitura_dos_proprios_checkins" ON "checkins";

CREATE POLICY "leitura_do_proprio_usuario" ON "users"
  FOR SELECT TO habits_readonly
  USING ("id" = current_setting('app.usuario_atual', true));

CREATE POLICY "leitura_dos_proprios_habitos" ON "habits"
  FOR SELECT TO habits_readonly
  USING ("userId" = current_setting('app.usuario_atual', true));

CREATE POLICY "leitura_dos_proprios_checkins" ON "checkins"
  FOR SELECT TO habits_readonly
  USING (
    EXISTS (
      SELECT 1 FROM "habits" h
      WHERE h."id" = "checkins"."habitId"
        AND h."userId" = current_setting('app.usuario_atual', true)
    )
  );
