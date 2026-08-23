# Ferramentas exigidas

Referência das Camadas de validação do `AGENTS.md`. Está aqui, e não lá, pelo
mesmo motivo que `docs/ARQUITETURA.md` existe: é consulta, não regra, e o teto de
linhas do AGENTS.md é gasto melhor com invariante.

| Ferramenta | Versão | Como conferir |
|---|---|---|
| Node | **22** (o do CI) | `node --version` |
| Docker | daemon **em execução**, não só o cliente | `docker info` |
| `jq` | qualquer | `jq --version` |
| `git archive` | do próprio git | `git archive --format=tar HEAD \| tar -t \| head -1` |

`docker --version` responde com o daemon desligado. Só `docker info` prova que as
Camadas 2 e 3 são executáveis.

