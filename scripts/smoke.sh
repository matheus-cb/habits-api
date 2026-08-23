#!/usr/bin/env bash
# Smoke HTTP contra a stack de verdade — Camada 3.
#
# O que ele prova, e nenhuma outra camada prova:
#
# - que a IMAGEM sobe. O Dockerfile anterior produzia um container em loop de
#   reinício e ninguém notava, porque nada no gate subia a stack.
# - que as migrações são aplicadas antes do primeiro request.
# - que a API funciona SEM `ANTHROPIC_API_KEY` num processo real, e não só num
#   teste que dubla o provedor (INV-15).
# - que o servidor MCP responde pelo transporte HTTP de verdade, com
#   autenticação real (INV-17).
#
# Por que aqui e não só no workflow: o `quality-gate` do NotaFlow mantém setenta
# linhas de `curl` embutidas no YAML, e documenta a escolha — não reproduzir
# localmente para não ter duas cópias divergindo. Um script chamado pelo CI
# resolve os dois lados: uma cópia só, e rodável na estação de trabalho.
#
# Uso:
#   docker compose up --detach --build --wait
#   ./scripts/smoke.sh
set -uo pipefail

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:3333}"
API="$BASE/api/v1"
SUFIXO="${SMOKE_SUFFIX:-$$}"

falhas=0
total=0

vermelho=$'\033[31m'
verde=$'\033[32m'
reset=$'\033[0m'

# Cada asserção imprime a invariante que está verificando. Falha mostra esperado,
# recebido e o corpo — sem o corpo, um smoke vermelho no CI não diz nada.
ok() {
  total=$((total + 1))
  printf '  %s✓%s %s\n' "$verde" "$reset" "$1"
}

falhar() {
  total=$((total + 1))
  falhas=$((falhas + 1))
  printf '  %s✗%s %s\n' "$vermelho" "$reset" "$1" >&2
  [ -n "${2:-}" ] && printf '      %s\n' "$2" >&2
  return 0
}

conferir_status() {
  local descricao="$1" esperado="$2" recebido="$3" corpo="${4:-}"
  if [ "$recebido" = "$esperado" ]; then
    ok "$descricao"
  else
    falhar "$descricao" "esperado HTTP $esperado, recebido $recebido — corpo: ${corpo:0:300}"
  fi
}

conferir_igual() {
  local descricao="$1" esperado="$2" recebido="$3" contexto="${4:-}"
  if [ "$recebido" = "$esperado" ]; then
    ok "$descricao"
  else
    falhar "$descricao" "esperado '$esperado', recebido '$recebido' — $contexto"
  fi
}

# `curl` escrevendo o status na última linha: separa corpo de status sem dois
# requests, que em endpoint com efeito colateral daria resultado diferente.
requisitar() {
  curl --silent --show-error --max-time 20 --write-out '\n%{http_code}' "$@" 2>&1
}

corpo_de() { sed '$d' <<<"$1"; }
status_de() { tail -n1 <<<"$1"; }

echo "== Camada 3 — smoke HTTP em $BASE"

# ── 1. A stack está de pé ───────────────────────────────────────────────────────
echo ""
echo "1. saúde da stack"

resposta=$(curl --silent --show-error --max-time 20 --retry 12 --retry-delay 5 \
  --retry-connrefused --write-out '\n%{http_code}' "$BASE/health" 2>&1)
corpo=$(corpo_de "$resposta")
conferir_status "GET /health responde 200 (a imagem sobe e as migrações rodaram)" \
  200 "$(status_de "$resposta")" "$corpo"

# O /health consulta o banco. A versão anterior só dizia que o processo estava
# vivo, e isso produziu um verde falso no CI: o container subiu SEM NENHUMA
# TABELA — as migrações não estavam versionadas —, reportou healthy para o
# `docker compose --wait`, e só o registro de usuário revelou, com 500.
conferir_igual "o healthcheck confirma que o esquema está aplicado" \
  up "$(jq -r '.data.database // "ausente"' <<<"$corpo")" "$corpo"

if [ "$(status_de "$resposta")" != "200" ]; then
  echo ""
  echo "A stack não subiu. Sem isso nada abaixo tem significado — abortando." >&2
  exit 1
fi

# ── 2. Autenticação é do servidor ───────────────────────────────────────────────
echo ""
echo "2. INV-10 — identidade vem só do JWT"

resposta=$(requisitar "$API/habits")
conferir_status "GET /habits sem token responde 401" 401 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

# Um userId no corpo não pode autenticar ninguém.
resposta=$(requisitar -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Invadir","userId":"qualquer"}' "$API/habits")
conferir_status "POST /habits com userId no corpo e sem token responde 401" \
  401 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar -H 'Authorization: Bearer nao-e-um-jwt' "$API/habits")
conferir_status "GET /habits com token inválido responde 401" \
  401 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

# ── 3. Cadastro e login ─────────────────────────────────────────────────────────
echo ""
echo "3. cadastro, login e INV-11"

registrar() {
  requisitar -H 'Content-Type: application/json' \
    -d "{\"name\":\"Smoke\",\"email\":\"$1\",\"password\":\"senha-de-smoke-123\"}" \
    "$API/auth/register"
}

email_a="smoke-a-$SUFIXO@example.com"
email_b="smoke-b-$SUFIXO@example.com"

resposta=$(registrar "$email_a")
corpo=$(corpo_de "$resposta")
conferir_status "POST /auth/register responde 201" 201 "$(status_de "$resposta")" "$corpo"
token_a=$(jq -r '.data.accessToken // empty' <<<"$corpo")
[ -n "$token_a" ] && ok "o registro devolve accessToken" || falhar "o registro devolve accessToken" "$corpo"

if grep -qE '\$2[aby]\$' <<<"$corpo"; then
  falhar "INV-11: a resposta do registro não carrega hash de senha" "hash bcrypt encontrado no corpo"
else
  ok "INV-11: a resposta do registro não carrega hash de senha"
fi
if grep -q 'senha-de-smoke-123' <<<"$corpo"; then
  falhar "INV-11: a resposta não devolve a senha enviada" "senha em claro no corpo"
else
  ok "INV-11: a resposta não devolve a senha enviada"
fi

resposta=$(registrar "$email_b")
token_b=$(jq -r '.data.accessToken // empty' <<<"$(corpo_de "$resposta")")

# Email repetido é conflito, não erro genérico.
resposta=$(registrar "$email_a")
conferir_status "registrar o mesmo email de novo responde 409" \
  409 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

auth_a=(-H "Authorization: Bearer $token_a")
auth_b=(-H "Authorization: Bearer $token_b")
json=(-H 'Content-Type: application/json')

# ── 4. Agendamento e validação ──────────────────────────────────────────────────
echo ""
echo "4. INV-07 — scheduledDays é subconjunto de 0..6 sem repetição"

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d '{"title":"Dia repetido","scheduledDays":[1,1]}' "$API/habits")
conferir_status "criar hábito com dia repetido responde 400" \
  400 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d '{"title":"Dia invalido","scheduledDays":[7]}' "$API/habits")
conferir_status "criar hábito com dia 7 responde 400" \
  400 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d '{"title":"Correr","scheduledDays":[1,3,5]}' "$API/habits")
corpo=$(corpo_de "$resposta")
conferir_status "criar hábito válido responde 201" 201 "$(status_de "$resposta")" "$corpo"
habito=$(jq -r '.data.id // empty' <<<"$corpo")
conferir_igual "os dias agendados voltam ordenados como enviados" \
  '[1,3,5]' "$(jq -c '.data.scheduledDays' <<<"$corpo")" "$corpo"

# ── 5. Check-in: um por dia, garantido pelo banco ───────────────────────────────
echo ""
echo "5. INV-01 e INV-05 — um check-in por hábito por dia"

# Dois instantes do MESMO dia UTC: prova que `@db.Date` + `@@unique` fazem o
# trabalho, e que o dia não é resolvido em horário local (INV-04).
dia=$(date -u -v-3d +%Y-%m-%d 2>/dev/null || date -u -d '3 days ago' +%Y-%m-%d)

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d "{\"date\":\"${dia}T01:00:00.000Z\"}" "$API/habits/$habito/checkin")
conferir_status "primeiro check-in do dia responde 201" 201 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d "{\"date\":\"${dia}T22:00:00.000Z\"}" "$API/habits/$habito/checkin")
conferir_status "INV-01/INV-04: outro horário do mesmo dia UTC responde 409" \
  409 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito/checkins")
conferir_igual "INV-01: existe exatamente 1 check-in gravado" \
  1 "$(jq '.data | length' <<<"$(corpo_de "$resposta")")" "$(corpo_de "$resposta")"

# Duas requisições simultâneas: aqui a consulta prévia do service não protege, e
# quem barra é a constraint. O perdedor tem de receber 409, não 500.
dia_corrida=$(date -u -v-5d +%Y-%m-%d 2>/dev/null || date -u -d '5 days ago' +%Y-%m-%d)
for _ in 1 2; do
  curl --silent --output /dev/null --write-out '%{http_code}\n' --max-time 20 \
    "${auth_a[@]}" "${json[@]}" -d "{\"date\":\"${dia_corrida}T12:00:00.000Z\"}" \
    "$API/habits/$habito/checkin" &
done >/tmp/smoke-corrida-$SUFIXO.txt
wait
corrida=$(sort /tmp/smoke-corrida-$SUFIXO.txt | tr '\n' ' ' | xargs)
rm -f /tmp/smoke-corrida-$SUFIXO.txt
if [ "$corrida" = "201 409" ]; then
  ok "INV-05: dois pedidos simultâneos dão 201 e 409, nunca 500"
else
  falhar "INV-05: dois pedidos simultâneos dão 201 e 409, nunca 500" "recebido: $corrida"
fi

# ── 6. Aderência medida contra dias agendados ───────────────────────────────────
echo ""
echo "6. INV-06 — aderência contra dias agendados"

resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito/stats")
corpo=$(corpo_de "$resposta")
conferir_status "GET /habits/:id/stats responde 200" 200 "$(status_de "$resposta")" "$corpo"

for campo in windowDays scheduledDaysInWindow completedInWindow extraCheckins completionRate; do
  if [ "$(jq -r ".data.$campo // \"ausente\"" <<<"$corpo")" = "ausente" ]; then
    falhar "stats devolve o campo $campo" "$corpo"
  else
    ok "stats devolve o campo $campo"
  fi
done

taxa=$(jq -r '.data.completionRate' <<<"$corpo")
if awk "BEGIN{exit !($taxa >= 0 && $taxa <= 100)}"; then
  ok "INV-06: completionRate fica entre 0 e 100 (é $taxa%)"
else
  falhar "INV-06: completionRate fica entre 0 e 100" "recebido $taxa"
fi

# O hábito nasceu agora, então a janela tem 1 dia — a janela nunca começa antes
# da criação do hábito. É o comportamento que corrigiu o "3% no primeiro dia".
conferir_igual "INV-06: a janela de um hábito novo tem 1 dia" \
  1 "$(jq -r '.data.windowDays' <<<"$corpo")" "$corpo"

# ── 7. Isolamento entre usuários ────────────────────────────────────────────────
echo ""
echo "7. INV-03 — hábito só é acessível pelo dono"

resposta=$(requisitar "${auth_b[@]}" "$API/habits/$habito")
conferir_status "ler hábito de outra pessoa responde 403" \
  403 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_b[@]}" "${json[@]}" -d '{}' "$API/habits/$habito/checkin")
conferir_status "marcar check-in em hábito de outra pessoa responde 403" \
  403 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_b[@]}" -X DELETE "$API/habits/$habito")
conferir_status "apagar hábito de outra pessoa responde 403" \
  403 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_b[@]}" "$API/habits")
conferir_igual "a lista da outra pessoa não vaza o hábito" \
  0 "$(jq '.data | length' <<<"$(corpo_de "$resposta")")" "$(corpo_de "$resposta")"

# ── 8. A camada de IA funciona sem chave ────────────────────────────────────────
echo ""
echo "8. INV-15 e INV-16 — insights sem provedor de IA configurado"

resposta=$(requisitar "$API/insights/adherence")
conferir_status "GET /insights/adherence sem token responde 401" \
  401 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "$API/insights/adherence")
corpo=$(corpo_de "$resposta")
conferir_status "GET /insights/adherence responde 200" 200 "$(status_de "$resposta")" "$corpo"

# O ponto central deste bloco: num processo REAL, sem chave no ambiente, o
# endpoint responde íntegro e declara quem redigiu.
conferir_igual "INV-15: narration.source é 'deterministic'" \
  deterministic "$(jq -r '.data.narration.source' <<<"$corpo")" "$corpo"
conferir_igual "INV-15: fallbackReason é AI_NOT_CONFIGURED" \
  AI_NOT_CONFIGURED "$(jq -r '.data.narration.fallbackReason' <<<"$corpo")" "$corpo"

resumo=$(jq -r '.data.narration.summary' <<<"$corpo")
if [ -n "$resumo" ] && [ "$resumo" != "null" ]; then
  ok "INV-15: o resumo determinístico não vem vazio"
else
  falhar "INV-15: o resumo determinístico não vem vazio" "$corpo"
fi

if grep -qiE 'sk-ant|você redige|x-api-key|thinking' <<<"$corpo"; then
  falhar "INV-16: a resposta não carrega chave, prompt nem raciocínio" "vazamento no corpo"
else
  ok "INV-16: a resposta não carrega chave, prompt nem raciocínio"
fi

# ── 9. Reagendamento é proposta, nunca aplicação ────────────────────────────────
echo ""
echo "9. INV-18 e INV-19 — reagendamento só pelo confirm"

resposta=$(requisitar "${auth_a[@]}" "$API/insights/reschedule-proposals")
corpo=$(corpo_de "$resposta")
conferir_status "GET /insights/reschedule-proposals responde 200" \
  200 "$(status_de "$resposta")" "$corpo"
if jq -e '.data | type == "array"' >/dev/null <<<"$corpo"; then
  ok "as propostas vêm como lista (vazia é resultado normal)"
else
  falhar "as propostas vêm como lista" "$corpo"
fi

# Nada aqui altera estado: o agendamento tem de estar intacto depois de propor.
resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito")
conferir_igual "INV-18: propor não alterou o agendamento" \
  '[1,3,5]' "$(jq -c '.data.scheduledDays' <<<"$(corpo_de "$resposta")")" "$(corpo_de "$resposta")"

# Token forjado: o payload é bem formado e a assinatura é inventada.
forjado="$(printf '%s' '{"userId":"x","habitId":"y","currentScheduledDays":[1],"proposedScheduledDays":[0,1,2,3,4,5,6],"expiresAt":99999999999999}' | base64 | tr '+/' '-_' | tr -d '=\n').$(printf '%s' 'assinatura-inventada' | base64 | tr '+/' '-_' | tr -d '=\n')"
resposta=$(requisitar "${auth_a[@]}" "${json[@]}" \
  -d "{\"token\":\"$forjado\"}" "$API/insights/reschedule-proposals/confirm")
conferir_status "INV-18: confirm com token forjado responde 400" \
  400 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "${json[@]}" -d '{}' \
  "$API/insights/reschedule-proposals/confirm")
conferir_status "INV-18: confirm sem token responde 400" \
  400 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito")
conferir_igual "INV-18: nenhuma tentativa recusada alterou o agendamento" \
  '[1,3,5]' "$(jq -c '.data.scheduledDays' <<<"$(corpo_de "$resposta")")" "$(corpo_de "$resposta")"

# ── 10. MCP: tools de leitura e as duas primitivas, pelo transporte de verdade ──
echo ""
echo "10. INV-17/INV-25 — superfície MCP"

mcp=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')

resposta=$(requisitar "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "$BASE/mcp")
conferir_status "POST /mcp sem token responde 401" 401 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

requisitar "${auth_a[@]}" "${mcp[@]}" -X POST -d \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  "$BASE/mcp" >/dev/null

resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$BASE/mcp")
corpo=$(corpo_de "$resposta")
conferir_status "tools/list responde 200 com token" 200 "$(status_de "$resposta")" "$corpo"

nomes=$(jq -r '[.result.tools[].name] | sort | join(",")' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-25: a superfície anunciada é a declarada" \
  'get_adherence_report,get_habit,get_habit_stats,list_checkins,list_habits,query,request' \
  "$nomes" "$corpo"

# A propriedade que a mudança de desenho torna crítica: exatamente UMA escreve.
# Enquanto tudo era leitura isto era grátis; agora é a fronteira do desenho, e é a
# anotação por onde o cliente decide se pede confirmação.
escrevem=$(jq -r '[.result.tools[] | select(.annotations.readOnlyHint != true) | .name] | join(",")' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-25: só \`request\` não se declara somente leitura" 'request' "$escrevem" "$corpo"

# ── 10b. As primitivas na imagem, não só na suíte ───────────────────────────────
# A Camada 2 prova o comportamento com a aplicação carregada em processo. Esta
# prova que o CONTAINER tem a role somente-leitura configurada e o RLS aplicado —
# `DATABASE_URL_READONLY` ausente na imagem faz `query` simplesmente não existir,
# e nenhuma outra camada veria isso.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT count(*)::int AS n FROM users"}}}' \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
linhas=$(jq -r '.result.content[0].text | fromjson | .linhas[0].n' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-27: SELECT em users pela primitiva devolve UMA linha, a de quem chamou" \
  1 "$linhas" "$corpo"

# Escrita pela primitiva é recusada pela GRAMÁTICA do Postgres: o envelope
# `SELECT * FROM (…) AS sub` faz o parser dele rejeitar UPDATE, e também CTE que
# escreve ("must be at the top level"). A barreira de PERMISSÃO continua atrás
# dela, e é a Camada 2 que a exercita sem o envelope — aqui ela é invisível.
# A asserção anterior grepava 'permission denied' e passou a falhar quando o
# envelope entrou: o modo de falha mudou, e a asserção descrevia o antigo.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"query","arguments":{"sql":"UPDATE habits SET title = '"'"'invadido'"'"'"}}}' \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
if grep -q 'A consulta falhou' <<<"$corpo"; then
  ok "INV-27: UPDATE pela primitiva e recusado pelo banco na imagem"
else
  falhar "INV-27: UPDATE pela primitiva e recusado pelo banco na imagem" "$corpo"
fi

# E nenhuma linha mudou: a tentativa nao escreveu.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT count(*)::int AS n FROM habits WHERE title = '"'"'invadido'"'"'"}}}' \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
invadidos=$(jq -r '.result.content[0].text | fromjson | .linhas[0].n' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-27: nenhuma linha foi alterada pela tentativa" 0 "$invadidos" "$corpo"

resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"request","arguments":{"metodo":"PUT","path":"/api/v1/auth/profile","corpo":{"email":"x@y.z"}}}}' \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
# `isError` sozinho NÃO serve aqui: contra a imagem antiga, sem as primitivas, a
# resposta era `Tool request not found` — também `isError`, e a asserção passava
# provando o oposto do que dizia. A mensagem tem de vir da allowlist.
if grep -q 'não está no alcance do assistente' <<<"$corpo"; then
  ok "INV-26: rota fora da allowlist é recusada pela primitiva na imagem"
else
  falhar "INV-26: rota fora da allowlist é recusada pela primitiva na imagem" "$corpo"
fi

# `request` alcançando a própria API pelo loopback só funciona se o endereço
# OBSERVADO estiver registrado. Um `registrarEnderecoLocal` que não fosse chamado
# em `server.ts` daria 401 aqui, e em nenhum outro lugar.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"request","arguments":{"metodo":"GET","path":"/api/v1/habits"}}}' \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
status_interno=$(jq -r '.result.content[0].text | fromjson | .status' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-25: a primitiva alcança a própria API pelo endereço observado" \
  200 "$status_interno" "$corpo"

resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":14,"method":"resources/list","params":{}}' "$BASE/mcp")
corpo=$(corpo_de "$resposta")
uris=$(jq -r '[.result.resources[].uri] | sort | join(",")' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-25: os quatro recursos de descoberta são anunciados" \
  'habits://contratos,habits://openapi,habits://rotas,habits://schema' "$uris" "$corpo"

# ── 10d. INV-31: histórico de edição na imagem ──────────────────────────────────
#
# A Camada 2 prova o comportamento com a aplicação em processo. Esta prova que a
# migração `historico_de_edicao` rodou no CONTAINER — o `migrate deploy` do
# entrypoint é o único lugar onde isso pode falhar, e o sintoma seria 500 na rota
# de revisões, que nenhuma camada abaixo veria.
echo ""
echo "10d. INV-31 — histórico de edição"

resposta=$(requisitar "${auth_a[@]}" -X PUT -H 'Content-Type: application/json' \
  -d '{"title":"Titulo editado pelo smoke"}' "$API/habits/$habito")
conferir_status "PUT /habits/:id edita" 200 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito/revisions")
corpo=$(corpo_de "$resposta")
conferir_status "GET /habits/:id/revisions responde 200" 200 "$(status_de "$resposta")" "$corpo"

quantas=$(jq -r '.data | length' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-31: a edição deixou UMA versão anterior" 1 "$quantas" "$corpo"

revisao=$(jq -r '.data[0].id' <<<"$corpo" 2>/dev/null)
titulo_antigo=$(jq -r '.data[0].title' <<<"$corpo" 2>/dev/null)

resposta=$(requisitar "${auth_a[@]}" -X POST "$API/habits/$habito/revisions/$revisao/restore")
corpo=$(corpo_de "$resposta")
conferir_status "POST .../revisions/:id/restore responde 200" 200 "$(status_de "$resposta")" "$corpo"
conferir_igual "INV-31: restaurar devolveu o título anterior" \
  "$titulo_antigo" "$(jq -r '.data.title' <<<"$corpo" 2>/dev/null)" "$corpo"

# E restaurar gravou revisão TAMBÉM: sem isso, desfazer destruiria o estado de
# onde se desfez, e a segunda volta não teria para onde ir.
resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito/revisions")
corpo=$(corpo_de "$resposta")
conferir_igual "INV-31: restaurar também gravou versão (agora são duas)" \
  2 "$(jq -r '.data | length' <<<"$corpo" 2>/dev/null)" "$corpo"

# A anotação derivada, contra o endpoint real: era `true` enquanto PUT e o confirm
# sobrescreviam sem histórico, e virou `false` sem ninguém editar `primitivas.ts`.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d '{"jsonrpc":"2.0","id":15,"method":"tools/list","params":{}}' "$BASE/mcp")
corpo=$(corpo_de "$resposta")
hint=$(jq -r '.result.tools[] | select(.name=="request") | .annotations.destructiveHint' <<<"$corpo" 2>/dev/null)
conferir_igual "INV-31: destructiveHint da tool request é false na imagem" false "$hint" "$corpo"



# Chamar uma tool de escrita que não existe: erro, nunca sucesso silencioso.
resposta=$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"create_checkin\",\"arguments\":{\"habitId\":\"$habito\"}}}" \
  "$BASE/mcp")
corpo=$(corpo_de "$resposta")
if jq -e '.error != null or .result.isError == true' >/dev/null <<<"$corpo" 2>/dev/null; then
  ok "INV-17: chamar create_checkin pelo MCP é erro, não sucesso"
else
  falhar "INV-17: chamar create_checkin pelo MCP é erro, não sucesso" "$corpo"
fi

# E o check-in do dia continua sendo um só: a tentativa não escreveu nada.
resposta=$(requisitar "${auth_a[@]}" "$API/habits/$habito/checkins")
conferir_igual "INV-17: a tentativa pelo MCP não criou check-in" \
  2 "$(jq '.data | length' <<<"$(corpo_de "$resposta")")" "$(corpo_de "$resposta")"

resposta=$(requisitar "${auth_a[@]}" -X GET "$BASE/mcp")
conferir_status "GET /mcp responde 405 (o transporte não tem sessão)" \
  405 "$(status_de "$resposta")" "$(corpo_de "$resposta")"

# ── 10c. INV-30: o teto de frequência está MONTADO ──────────────────────────────
#
# Os unitários provam a lógica do middleware. Nenhum deles pode ver se ele está
# montado em `/mcp` — um `app.use` esquecido deixaria a suíte inteira verde com a
# primitiva de execução arbitrária sem teto nenhum. Só bater na imagem prova.
#
# Este bloco fica no FIM da seção de propósito: ele esgota o teto por usuário, e
# qualquer chamada MCP depois dele receberia 429 por consequência deste teste em
# vez de por defeito.
echo ""
echo "10c. INV-30 — teto de frequência do MCP"

visto_429=0
for _ in $(seq 1 70); do
  codigo=$(status_de "$(requisitar "${auth_a[@]}" "${mcp[@]}" -X POST \
    -d '{"jsonrpc":"2.0","id":99,"method":"tools/list","params":{}}' "$BASE/mcp")")
  if [ "$codigo" = "429" ]; then
    visto_429=1
    break
  fi
done
conferir_igual "INV-30: um laço em /mcp recebe 429 antes de 70 chamadas" 1 "$visto_429" \
  'nenhuma das 70 chamadas foi limitada — o middleware está montado?'

# ── Resultado ───────────────────────────────────────────────────────────────────
echo ""
if [ "$falhas" -gt 0 ]; then
  printf '%sRESULTADO: %d de %d asserções falharam.%s\n' "$vermelho" "$falhas" "$total" "$reset" >&2
  exit 1
fi
printf '%sRESULTADO: %d asserções passaram.%s\n' "$verde" "$total" "$reset"
