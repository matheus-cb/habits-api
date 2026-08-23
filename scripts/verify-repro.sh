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
# A stack do clone sobe com `STACK_PREFIX`, `POSTGRES_PORT` e `API_PORT`, que o
# `docker-compose.yml` interpola. A versão anterior editava o compose do clone com
# dois `sed`, e isso era errado por dois motivos: `sed` sobre YAML quebra em
# qualquer reformatação válida — um comentário entre a chave `ports:` e o item já
# derrotava o padrão, silenciosamente — e a camada que existe para testar o
# repositório não pode mexer no repositório antes de testá-lo.
#
# Uso: ./scripts/verify-repro.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

destino="${REPRO_DIR:-/tmp/habits-api-repro}"
projeto="${REPRO_PROJECT:-habits-repro}"
porta="${REPRO_PORT:-3399}"
porta_db="${REPRO_POSTGRES_PORT:-55432}"

vermelho=$'\033[31m'
verde=$'\033[32m'
reset=$'\033[0m'

falhar_e_sair() {
  printf '%s✗%s %s\n' "$vermelho" "$reset" "$1" >&2
  exit "${2:-1}"
}

# Guarda antes de qualquer `rm -rf`. `REPRO_DIR` vem do ambiente e o `trap EXIT`
# garante que o `rm` roda mesmo em falha, então um valor descuidado apaga o que
# não devia sem nada perguntar. Já se perdeu um banco de desenvolvimento hoje por
# um comando que não checou para onde apontava; é o mesmo formato de risco.
case "$destino" in
  /) falhar_e_sair "REPRO_DIR não pode ser a raiz." 3 ;;
  "$HOME") falhar_e_sair "REPRO_DIR não pode ser o diretório do usuário." 3 ;;
  *' '*) falhar_e_sair "REPRO_DIR com espaço não é suportado: '$destino'." 3 ;;
  /*/*) : ;;
  *) falhar_e_sair "REPRO_DIR deve ser caminho absoluto com mais de um componente; é '$destino'." 3 ;;
esac

limpar() {
  docker compose -p "$projeto" -f "$destino/docker-compose.yml" down --volumes --remove-orphans >/dev/null 2>&1
  rm -rf "$destino"
}
trap limpar EXIT

echo "== Camada 3.5 — clone limpo a partir de HEAD"

command -v jq >/dev/null 2>&1 || falhar_e_sair "jq não instalado." 3
docker info >/dev/null 2>&1 || falhar_e_sair "daemon Docker não está em execução." 3

rm -rf "$destino"
mkdir -p "$destino" || falhar_e_sair "não consegui criar $destino." 3

# Sem `-e` global — o `$?` do smoke é lido adiante —, então a falha do pipeline
# tem de ser checada aqui. Sem isto, `git archive` falhando deixava o destino
# vazio e a mensagem seguinte era "HEAD não contém nenhuma migração": diagnóstico
# falso, que manda investigar o .gitignore de novo.
#
# Código 3, não 1: é "não pude verificar", não "não reproduz". Mesma distinção do
# verify.sh.
if ! git archive --format=tar HEAD | tar -x -C "$destino"; then
  falhar_e_sair "git archive falhou — nada a verificar." 3
fi

# A checagem mais barata, e a que teria pegado o defeito original.
migracoes="$(find "$destino/prisma/migrations" -name 'migration.sql' 2>/dev/null | wc -l | tr -d ' ')"
[ "$migracoes" -gt 0 ] ||
  falhar_e_sair "HEAD não contém nenhuma migração. Um clone sobe sem tabela."
printf '%s✓%s HEAD contém %s migração(ões)\n' "$verde" "$reset" "$migracoes"

cd "$destino"
export JWT_SECRET="${JWT_SECRET:-repro-only-secret-with-at-least-32-chars}"
export STACK_PREFIX="$projeto"
export POSTGRES_PORT="$porta_db"
export API_PORT="$porta"

echo "▶ subindo a stack do clone ($projeto, api em $porta, banco em $porta_db)"
if ! docker compose -p "$projeto" up --detach --build --wait >/dev/null 2>&1; then
  printf '%s✗%s a stack do clone não subiu. Logs:\n' "$vermelho" "$reset" >&2
  docker compose -p "$projeto" logs --no-color --tail 40 >&2
  exit 1
fi
printf '%s✓%s a stack do clone subiu saudável\n' "$verde" "$reset"

# O smoke do CLONE, não o local: se o script tiver ficado fora do git, isto falha
# — e é uma das coisas que esta camada existe para descobrir.
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
