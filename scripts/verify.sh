#!/usr/bin/env bash
# Validação local em camadas, por dependência externa.
#
# Camada 1 não depende de nada além do Node: é obrigatória e falha o script.
# Camada 2 exige PostgreSQL. Sem banco ela AVISA em vez de falhar — mas o script
# sai com código 3, para que automação que só lê o exit status não confunda
# "pulou" com "passou". Verde falso é pior do que vermelho.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

pulou=""
falhou=0

passo() {
  echo ""
  echo "▶ $*"
  if ! "$@"; then
    echo "✗ falhou: $*" >&2
    falhou=1
  fi
}

echo "== Camada 1 — sem dependência externa (obrigatória)"
passo ./scripts/check-agent-docs.sh
passo npx tsc --noEmit
passo npm run lint
passo npm run test:unit

echo ""
echo "== Camada 2 — exige PostgreSQL e o banco de teste"
# A Camada 2 apaga tabelas, então roda em `habits_test` (de .env.test), nunca no
# banco de desenvolvimento. `tests/setup.ts` recusa qualquer outro nome.
if [ ! -f .env.test ]; then
  pulou="Camada 2: .env.test não encontrado."
elif ! npx --no-install dotenv -e .env.test -- prisma migrate status >/dev/null 2>&1; then
  pulou="Camada 2: banco de teste inalcançável. Rode: npm run docker:up && npm run db:test:create && npm run db:test:migrate"
else
  passo npm run test:integration
fi

echo ""
echo "== Camada 3 — sobe a stack e bate nela por HTTP"
# Não sobe a stack sozinho: `docker compose up --build` leva minutos e derrubar o
# que já estava rodando na máquina de quem chamou seria surpresa desagradável.
# Se a stack estiver de pé, roda; senão, diz como subir.
if ! command -v jq >/dev/null 2>&1; then
  pulou="${pulou:+$pulou }Camada 3: jq não instalado."
elif ! curl --silent --fail --max-time 3 "${SMOKE_BASE_URL:-http://127.0.0.1:3333}/health" >/dev/null 2>&1; then
  pulou="${pulou:+$pulou }Camada 3: stack não está de pé. Rode: docker compose up --detach --build --wait"
else
  passo ./scripts/smoke.sh
fi

echo ""
if [ "$falhou" -ne 0 ]; then
  echo "RESULTADO: falhou." >&2
  exit 1
fi

if [ -n "$pulou" ]; then
  echo "RESULTADO: o que rodou passou; $pulou" >&2
  exit 3
fi

echo "RESULTADO: todas as camadas passaram."
