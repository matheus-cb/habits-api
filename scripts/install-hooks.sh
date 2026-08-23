#!/usr/bin/env bash
# Instala os hooks versionados de `scripts/hooks/` em `.git/hooks/`.
#
# `core.hooksPath` seria mais direto, mas ele substitui o diretório inteiro de
# hooks — e quem já tiver um hook próprio o perderia sem aviso. Copiar preserva o
# que existe e falha alto quando encontraria algo diferente.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

origem="scripts/hooks"
destino="$(git rev-parse --git-path hooks)"

for hook in "$origem"/*; do
  nome="$(basename "$hook")"
  alvo="$destino/$nome"

  if [ -e "$alvo" ] && ! cmp -s "$hook" "$alvo"; then
    echo "✗ $alvo já existe e é DIFERENTE do versionado." >&2
    echo "  Compare com \`diff $alvo $hook\` e resolva à mão." >&2
    exit 1
  fi

  cp "$hook" "$alvo"
  chmod +x "$alvo"
  echo "✓ $nome instalado em $alvo"
done
