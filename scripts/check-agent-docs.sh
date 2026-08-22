#!/usr/bin/env bash
# Gate da convenção dos arquivos de contexto de agente.
#
# O AGENTS.md exige que cada regra tenha um teste apontável. A regra "AGENTS.md é
# canônico, CLAUDE.md só importa" não tinha nenhum — e é justamente a que se
# viola sem ninguém notar, porque violá-la não quebra nada em tempo de execução.
# Este script é o teste dela.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

falhas=0
falhar() {
  echo "FALHA: $1" >&2
  falhas=$((falhas + 1))
}

# 1. A ponte existe e é a primeira coisa do arquivo. Sem isto o Claude Code não
#    enxerga nenhuma regra do projeto.
primeira="$(grep -m1 -v '^[[:space:]]*$' CLAUDE.md || true)"
[ "$primeira" = "@AGENTS.md" ] ||
  falhar "CLAUDE.md deve começar com o import '@AGENTS.md'; começa com '$primeira'."

# 2. O Codex para de ler ao atingir project_doc_max_bytes (32 KiB por padrão).
#    Passar disso trunca em silêncio, e o corte cai no meio das invariantes.
bytes="$(wc -c <AGENTS.md)"
[ "$bytes" -lt 32768 ] || falhar "AGENTS.md tem $bytes bytes; o Codex corta em 32768."

# 3. Regra de projeto no CLAUDE.md é regra que o Codex nunca vê.
if grep -qE 'INV-[0-9]|^\| *\*\*INV' CLAUDE.md; then
  falhar "CLAUDE.md cita invariante (INV-nn). Invariante é regra de projeto: vai no AGENTS.md."
fi

# 4. O CLAUDE.md é uma ponte, não um segundo manual.
linhas_claude="$(wc -l <CLAUDE.md)"
[ "$linhas_claude" -le 40 ] ||
  falhar "CLAUDE.md tem $linhas_claude linhas (máx. 40). Mova o que não for exclusivo do Claude Code para o AGENTS.md."

# 5. Adesão inversa é pior: acima de 200 linhas combinadas o modelo perde
#    aderência às instruções, e o problema deixa de ser de organização.
total=$((linhas_claude + $(wc -l <AGENTS.md)))
[ "$total" -le 200 ] || falhar "AGENTS.md + CLAUDE.md somam $total linhas; acima de 200 a aderência cai."

# 6. Import quebrado carrega nada e não avisa. Vale para os dois arquivos.
for arquivo in AGENTS.md CLAUDE.md; do
  while read -r alvo; do
    [ -n "$alvo" ] || continue
    [ -e "$alvo" ] || falhar "$arquivo importa '@$alvo', que não existe."
  # O `@` na classe negada evita casar o segundo arroba de `@@unique(...)`, que é
  # sintaxe do Prisma citada no texto e não um import.
  done < <(grep -oE '(^|[^`[:alnum:]@])@[A-Za-z0-9._/-]+' "$arquivo" | sed 's/.*@//')
done

# 7. Esta o NotaFlow não tem, e é a que mais custou aqui: invariante declarada
#    sem teste que a cite é invariante decorativa. O AGENTS.md manda usar o
#    número no nome do teste — então o número tem de aparecer em tests/.
#    Sem esta checagem, a tabela cresce e a cobertura não.
if [ -d tests ]; then
  faltando=""
  while read -r inv; do
    grep -rqF "$inv" tests/ || faltando="$faltando $inv"
  done < <(grep -oE 'INV-[0-9]{2}' AGENTS.md | sort -u)

  # INV-20 a INV-24 vivem nos clientes; os testes delas estão nos outros repos.
  for cliente in INV-20 INV-21 INV-22 INV-23 INV-24; do
    faltando="${faltando// $cliente/}"
  done

  [ -z "$faltando" ] ||
    falhar "invariante sem teste que a cite pelo número:$faltando. Ver 'Definição de pronto' no AGENTS.md."
fi

if [ "$falhas" -gt 0 ]; then
  echo "" >&2
  echo "$falhas verificação(ões) falharam. Ver AGENTS.md → 'Objetivo'." >&2
  exit 1
fi

echo "Convenção dos arquivos de contexto: ok ($bytes bytes no AGENTS.md, $total linhas no total)."
