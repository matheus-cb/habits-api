-- Guardiões estruturais da primitiva `query` do MCP.
--
-- A primitiva deixa o Claude Code escrever SQL livre. Duas coisas precisam ser
-- impossíveis, não improváveis:
--
--   1. escrever (INSERT/UPDATE/DELETE/DDL)
--   2. ler linha de outro usuário
--
-- Validar a query por parsing perderia: paráfrase, comentário, CTE, subconsulta.
-- É a mesma lição do guarda numérico da camada de IA, que valida texto com regex
-- e por isso só pega quem inventa número, não quem recombina. Aqui as duas
-- garantias vêm do banco.

-- ── 1. Role somente leitura ───────────────────────────────────────────────────
--
-- Sem nenhum grant de escrita. Um INSERT falha por permissão, não porque eu
-- adivinhei a gramática. `pg_read_all_data` é role predefinida do Postgres 14+.
--
-- A senha é de desenvolvimento e vem sobrescrita em produção pela variável
-- DATABASE_URL_READONLY — está aqui para o ambiente local subir sem passo manual.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'habits_readonly') THEN
    CREATE ROLE habits_readonly LOGIN PASSWORD 'habits_readonly_dev';
  END IF;
END
$$;

GRANT pg_read_all_data TO habits_readonly;
-- `current_database()` e não o nome literal.
--
-- Esta linha era `GRANT CONNECT ON DATABASE habits`, e o pressuposto exato — que
-- vale ser dito com precisão — não era "estamos conectados a `habits`": era
-- **"existe um banco chamado `habits` neste servidor"**. `GRANT ... ON DATABASE`
-- não exige conexão com o banco alvo, só que ele exista.
--
-- Por isso a Camada 2, que roda contra `habits_test`, passava: no meu Postgres
-- local os dois bancos existem no mesmo servidor. No serviço do CI existe só o de
-- teste, e a primeira execução reprovou com `database "habits" does not exist`.
--
-- É o quarto defeito que só o CI podia ver, e o mesmo formato dos três anteriores
-- (`npm install` contra `npm ci`, migrações fora do git, peers do Expo): a
-- verificação local rodava num ambiente onde o pressuposto era verdadeiro.
--
-- `GRANT ... ON DATABASE` não aceita parâmetro, então vai por SQL dinâmico.
-- `%I` e não `%s`: cita o identificador, o que importa se o nome tiver maiúscula
-- ou hífen — `habits-test` sem aspas é erro de sintaxe.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO habits_readonly', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO habits_readonly;

-- Teto de tempo no próprio role: uma query pesada não derruba a API. Guardião
-- estrutural — não depende de quem chama lembrar de passar timeout.
ALTER ROLE habits_readonly SET statement_timeout = '5s';
ALTER ROLE habits_readonly SET idle_in_transaction_session_timeout = '10s';

-- Explícito, mesmo sendo o default: nada de criar objeto no schema.
REVOKE CREATE ON SCHEMA public FROM habits_readonly;

-- ── 2. Row-Level Security ─────────────────────────────────────────────────────
--
-- As políticas comparam com `current_setting('app.current_user', true)`, definido
-- por `SET LOCAL` dentro da transação de cada consulta. `true` no segundo
-- argumento faz a função devolver NULL em vez de erro quando a variável não
-- existe — e NULL não casa com nada, então **sem o SET a consulta não vê nada**.
--
-- Essa é a propriedade que importa: esquecer o SET produz zero linhas, não
-- vazamento. Falha fechada, não aberta.
ALTER TABLE "users"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habits"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkins" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura_do_proprio_usuario" ON "users"
  FOR SELECT TO habits_readonly
  USING ("id" = current_setting('app.current_user', true));

CREATE POLICY "leitura_dos_proprios_habitos" ON "habits"
  FOR SELECT TO habits_readonly
  USING ("userId" = current_setting('app.current_user', true));

CREATE POLICY "leitura_dos_proprios_checkins" ON "checkins"
  FOR SELECT TO habits_readonly
  USING (
    EXISTS (
      SELECT 1 FROM "habits" h
      WHERE h."id" = "checkins"."habitId"
        AND h."userId" = current_setting('app.current_user', true)
    )
  );

-- O dono das tabelas (o role da aplicação) contorna RLS por padrão, e é isso que
-- se quer: a API continua funcionando exatamente como antes. RLS aqui existe só
-- para conter a primitiva `query`, não para mudar o comportamento da aplicação.
