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

# A saída INTEIRA vai para disco, sempre — e o terminal continua vendo tudo.
#
# Isto existe por um flake que ficou sem diagnóstico: um teste de integração
# falhou uma vez, eu tinha rodado o verify com `| grep "Tests:|RESULTADO"` e o
# filtro descartou o NOME do teste. Nove execuções depois não reproduziu, e a
# informação não estava mais disponível para ninguém olhar.
#
# É uma categoria diferente das outras desta safra: nas outras a evidência
# existia e a verificação olhava para o lado errado; nesta a evidência foi
# destruída. E é a mais barata de fechar — a regra é **filtre a exibição, nunca a
# captura**, e `tee` custa o mesmo que não usar.
LOG="${VERIFY_LOG:-$repo/.verify.log}"
: >"$LOG"

passo() {
  echo ""
  echo "▶ $*"
  {
    echo ""
    echo "▶ $*"
  } >>"$LOG"
  if ! "$@" 2>&1 | tee -a "$LOG"; then
    echo "✗ falhou: $*" >&2
    echo "✗ falhou: $*" >>"$LOG"
    falhou=1
  fi
}

echo "== Camada 1 — sem dependência externa (obrigatória)"
passo ./scripts/check-agent-docs.sh
# `npm ci --dry-run` antes de tudo, e é a lacuna que deixou o CI vermelho passar.
#
# O CI roda `npm ci`, que valida peers contra o lockfile e RECUSA conflito. Eu
# rodava `npm install`, que é permissivo e reconcilia. Resultado: verde aqui,
# vermelho lá, e eu reportei "verify verde" sem nunca ter executado o comando que
# o AGENTS.md lista primeiro.
#
# `--dry-run` faz a resolução completa sem apagar o `node_modules` nem baixar
# nada, então custa segundos em vez de minutos. É a diferença entre uma checagem
# que se roda sempre e uma que se pula.
passo npm ci --dry-run
passo npx tsc --noEmit
passo npm run lint
passo npm run test:unit
# `tsc --noEmit` não substitui o build: o `tsup` resolve import, bundle e saída, e
# já quebrou por caminho de alias que o typecheck aceita. O CI tem job próprio
# para isto, e a checagem 9 do gate documental é o que impede as duas listas de
# divergirem de novo.
passo npm run build

echo ""
echo "== Camada 2 — exige PostgreSQL e o banco de teste"
# A Camada 2 apaga tabelas, então roda em `habits_test` (de .env.test), nunca no
# banco de desenvolvimento. `tests/setup.ts` recusa qualquer outro nome.
if [ ! -f .env.test ]; then
  pulou="Camada 2: .env.test não encontrado."
elif ! npx --no-install dotenv -e .env.test -- prisma migrate status >/dev/null 2>&1; then
  pulou="Camada 2: banco de teste inalcançável. Rode: npm run docker:up && npm run db:test:create && npm run db:test:migrate"
else
  # Antes dos testes: se o esquema derivou, os testes rodam contra um banco que
  # não é o que o código espera, e a falha aparece disfarçada de bug de domínio.
  passo ./scripts/check-schema-drift.sh
  passo npm run test:integration
  # A MESMA suíte com o fuso deslocado 17 horas do local.
  #
  # O servidor resolve o dia em UTC (INV-04) e vários testes montam datas com
  # `new Date()` e aritmética LOCAL. Hoje isso é seguro — eles comparam instantes
  # absolutos derivados da mesma base, não chaves de dia construídas à mão — e
  # verifiquei sob UTC+14 e UTC−12. Mas a segurança é uma propriedade de COMO os
  # testes estão escritos, não do desenho, e o próximo teste escrito com data
  # relativa pode não ter.
  #
  # O defeito que esta safra corrigiu no servidor era exatamente isto: dia
  # resolvido em horário local contra coluna `@db.Date` que o Prisma devolve em
  # UTC — invisível em UTC−3. O servidor foi corrigido; rodar a suíte num fuso
  # deslocado é o que impede a suíte de herdar a convenção antiga sem ninguém ver.
  passo npm run test:integration:tz
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
