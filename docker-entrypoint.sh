#!/bin/sh
# Aplica as migrações antes de subir o servidor.
#
# O container anterior não fazia isso: subia contra um banco sem tabela e o
# primeiro request morria em erro de relação inexistente. `migrate deploy` (e não
# `migrate dev`) é o comando certo aqui — ele só aplica o que já está versionado e
# nunca gera migração nova nem pede confirmação.
set -e

echo "→ aplicando migrações"
npx prisma migrate deploy

echo "→ iniciando servidor"
exec "$@"
