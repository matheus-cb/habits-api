#!/usr/bin/env bash
# As migrações versionadas produzem o `schema.prisma` atual?
#
# A checagem 8 do `check-agent-docs.sh` prova que toda migração no disco está no
# índice. Ela NÃO prova que as migrações estão atualizadas, e o caso que passa por
# ela é silencioso: alguém acrescenta um campo ao `schema.prisma` e não gera
# migração. Zero migrações fora do índice, gate verde, `git archive` traz tudo — e
# o clone aplica as migrações versionadas, subindo com o esquema ANTIGO.
#
# O erro então não aparece no boot nem no healthcheck: o Prisma Client é gerado do
# `schema.prisma`, então o código espera a coluna que o banco não tem, e a falha
# vem na primeira query que a toca. É exatamente o modo de falha "rastreado mas
# desatualizado" que sobreviveu à correção do .gitignore.
#
# Exige banco shadow porque `--from-migrations` aplica as migrações num banco
# vazio para comparar. A Camada 2 já tem Postgres de pé; o custo é um database a
# mais, criado por `npm run db:test:create`.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

shadow="${DATABASE_URL_SHADOW:-}"
if [ -z "$shadow" ] && [ -f .env.test ]; then
  shadow="$(grep -E '^DATABASE_URL_SHADOW=' .env.test | head -1 | cut -d= -f2- | tr -d '"')"
fi

if [ -z "$shadow" ]; then
  echo "DATABASE_URL_SHADOW não definido — não pude verificar drift de esquema." >&2
  exit 3
fi

# `--exit-code`: 0 sem diferença, 2 com diferença, 1 erro. Sem ele o comando
# imprime o diff e sai 0, e um gate que lê exit status não veria nada.
npx --no-install prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$shadow" \
  --exit-code >/tmp/schema-drift.$$ 2>&1
codigo=$?

case "$codigo" in
  0)
    rm -f /tmp/schema-drift.$$
    echo "Esquema: as migrações versionadas produzem o schema.prisma atual."
    ;;
  2)
    echo "FALHA: o schema.prisma difere do que as migrações produzem." >&2
    echo "Há mudança de esquema sem migração. Rode: npm run prisma:migrate" >&2
    echo "" >&2
    sed 's|^|  |' /tmp/schema-drift.$$ >&2
    rm -f /tmp/schema-drift.$$
    exit 1
    ;;
  *)
    echo "Não pude verificar drift (banco shadow inalcançável?):" >&2
    sed 's|^|  |' /tmp/schema-drift.$$ >&2
    rm -f /tmp/schema-drift.$$
    exit 3
    ;;
esac
