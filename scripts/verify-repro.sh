#!/usr/bin/env bash
# Camada 3.5 — o repositório reproduz o que a máquina reproduz?
#
# As Camadas 1, 2 e 3 testam o CÓDIGO. Nenhuma testa o REPOSITÓRIO. A Camada 3
# prova que a imagem funciona com o disco presente; a propriedade que faltava é
# que um clone limpo produza a mesma coisa.
#
# A diferença não é acadêmica. `.gitignore` mantinha `prisma/migrations/**/migration.sql`
# fora do git: as três camadas passavam aqui — os arquivos existem no disco — e o
# CI falhava, porque `migrate deploy` num clone não encontrava migração nenhuma e
# **saía com código 0**. Descobrir isso num PR custa um ciclo de CI; descobrir
# aqui custa um minuto.
#
# `git archive HEAD` entrega exatamente o que um clone entrega: só o rastreado.
# Nada de `.env`, nada de arquivo ignorado, nada de working tree sujo.
#
# Uso: ./scripts/verify-repro.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

destino="${REPRO_DIR:-/tmp/habits-api-repro}"
projeto="habits-repro"
porta="${REPRO_PORT:-3399}"

vermelho=$'\033[31m'
verde=$'\033[32m'
reset=$'\033[0m'

limpar() {
  docker compose -p "$projeto" -f "$destino/docker-compose.yml" down --volumes --remove-orphans >/dev/null 2>&1
  rm -rf "$destino"
}
trap limpar EXIT

echo "== Camada 3.5 — clone limpo a partir de HEAD"

if ! command -v jq >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Exige jq e daemon Docker em execução." >&2
  exit 3
fi

rm -rf "$destino"
mkdir -p "$destino"
git archive --format=tar HEAD | tar -x -C "$destino"

# Primeira checagem, e a que teria pegado o defeito: o esquema está no arquivo?
migracoes="$(find "$destino/prisma/migrations" -name 'migration.sql' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$migracoes" -eq 0 ]; then
  printf '%s✗%s HEAD não contém nenhuma migração. Um clone sobe sem tabela.\n' "$vermelho" "$reset" >&2
  exit 1
fi
printf '%s✓%s HEAD contém %s migração(ões)\n' "$verde" "$reset" "$migracoes"

# Porta, projeto e nomes de container próprios: rodar isto não pode derrubar nem
# colidir com a stack de quem chamou.
#
# O `container_name:` do compose é fixo (`habits-postgres`, `habits-api`) porque
# `npm run db:test:create` faz `docker exec` por nome. Nome fixo, porém, impede
# duas stacks simultâneas — `-p` isola rede e volume, não nome de container. A
# cópia do clone remove as linhas e deixa o Compose gerar nomes prefixados pelo
# projeto, que é o comportamento que permite o paralelo.
cd "$destino"
export JWT_SECRET="${JWT_SECRET:-repro-only-secret-with-at-least-32-chars}"
#
# E o Postgres do clone não publica porta nenhuma: 5432 já está tomada pela stack
# principal, e a API do clone fala com ele pela rede interna do projeto. Publicar
# porta de banco só serve para ferramenta externa — que aqui não existe.
#
# O `ports:` do Postgres sai INTEIRO — chave e item. Apagar só o item deixa
# `ports:` com lista vazia, e o Compose recusa: "services.postgres.ports must be
# a array". O `N` lê a linha seguinte e o par é removido junto.
# Dois passes, e a ordem importa. Num único `sed`, o `N` do segundo padrão puxa a
# linha do `3333:3333` para o espaço de padrões ANTES de a substituição de porta
# ser avaliada nela — e a porta ficava inalterada, colidindo com a stack
# principal. Separar os passes elimina a interação.
sed -i.bak -e '/^ *container_name:/d' -e "/^ *ports:/{N;/'5432:5432'/d;}" docker-compose.yml
sed -i.bak2 "s|'3333:3333'|'$porta:3333'|" docker-compose.yml
rm -f docker-compose.yml.bak docker-compose.yml.bak2

# Sem isto o clone tentaria publicar 3333 e a mensagem seria "port is already
# allocated", que não diz nada sobre reprodutibilidade.
grep -q "'$porta:3333'" docker-compose.yml || {
  printf '%s✗%s a porta do clone não foi remapeada para %s.\n' "$vermelho" "$reset" "$porta" >&2
  exit 1
}

# Se a edição quebrou o arquivo, dizer isso agora — e não como "a stack não subiu".
if ! docker compose -p "$projeto" config --quiet 2>/dev/null; then
  printf '%s✗%s a cópia do compose ficou inválida:\n' "$vermelho" "$reset" >&2
  docker compose -p "$projeto" config 2>&1 | tail -5 >&2
  exit 1
fi

echo "▶ subindo a stack do clone (projeto $projeto, porta $porta)"
if ! docker compose -p "$projeto" up --detach --build --wait >/dev/null 2>&1; then
  printf '%s✗%s a stack do clone não subiu. Logs:\n' "$vermelho" "$reset" >&2
  docker compose -p "$projeto" logs --no-color --tail 40 >&2
  exit 1
fi
printf '%s✓%s a stack do clone subiu saudável\n' "$verde" "$reset"

echo "▶ smoke contra o clone"
cd "$repo"
SMOKE_BASE_URL="http://127.0.0.1:$porta" SMOKE_SUFFIX="repro$$" "$destino/scripts/smoke.sh"
resultado=$?

echo ""
if [ "$resultado" -ne 0 ]; then
  printf '%sRESULTADO: o repositório NÃO reproduz. Há arquivo necessário fora do git.%s\n' "$vermelho" "$reset" >&2
  exit 1
fi
printf '%sRESULTADO: um clone de HEAD sobe e passa no smoke.%s\n' "$verde" "$reset"
