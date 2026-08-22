# AGENTS.md

## Objetivo

`habits-api` é o hub do ecossistema Habits: dashboard e mobile consomem os mesmos
endpoints em `/api/v1`. A prioridade é que o registro de hábitos seja exato e
recuperável; a IA é assistiva e **nunca executa sozinha**.

Regra nova, invariante ou comando entra **neste arquivo**, que todo agente lê. O
`CLAUDE.md` apenas o importa e guarda o que é mecânica exclusiva do Claude Code;
`scripts/check-agent-docs.sh` verifica isso, como qualquer outra regra daqui.

Não mova regra para `.claude/rules/` nem para `AGENTS.md` de subpasta: o primeiro
o Codex não lê, o segundo o Claude Code não lê. Instrução dividida por ferramenta
é instrução que metade dos agentes não recebe.

A numeração `INV-nn` é **compartilhada pelos três repositórios** do ecossistema
(`habits-api`, `habits-dashboard`, `habits-mobile`). INV-21 significa a mesma
coisa nos três. Cada repositório declara em cheio as invariantes que vivem nele.

## Invariantes

Regras numeradas e testáveis. Use o número no nome do teste e na mensagem de
commit — assim cada regra tem um teste apontável, em vez de "temos testes".

### Domínio e dados

| # | Regra | Onde vive |
|---|---|---|
| **INV-01** | Um check-in por hábito por dia é garantia do **banco**, não da consulta prévia | `prisma/schema.prisma` → `@@unique([habitId, date])` |
| **INV-02** | Repositório é a única porta do banco; service nunca importa Prisma | `src/repositories/` |
| **INV-03** | Hábito e check-in só são legíveis e alteráveis pelo dono | `habits`/`checkins`/`stats`.service |
| **INV-04** | O dia do check-in é resolvido em **UTC**; hora nunca entra na chave | `src/utils/helpers.ts` → `utcStartOfDay` |
| **INV-05** | Duplicata responde **409**, inclusive quando quem barra é a constraint | `checkins.service.ts` → `isUniqueConstraintViolation` |
| **INV-06** | Aderência é medida contra dias **agendados**, e a janela nunca começa antes da criação do hábito | `stats.service.ts` |
| **INV-07** | `scheduledDays` é subconjunto de 0..6 sem repetição; vazio significa todo dia | `schemas/habits.schema.ts` |
| **INV-08** | Check-in em dia não agendado é **aceito** e não altera a aderência | `checkins.service.ts`, `stats.service.ts` → `extraCheckins` |

### Contorno da API

| # | Regra | Onde vive |
|---|---|---|
| **INV-09** | Zod valida o ambiente na inicialização: sobe configurado ou não sobe | `src/config/env.ts` |
| **INV-10** | Identidade vem só do JWT verificado; nunca de body, query ou header solto | `middlewares/auth.middleware.ts` |
| **INV-11** | Senha nunca sai do service para a resposta | `auth.service.ts` |
| **INV-12** | Erro esperado é `AppError` com status; erro desconhecido não vaza mensagem em produção | `middlewares/error.middleware.ts` |

### IA

A fronteira é a mesma em toda a camada: **a IA sugere, o código valida, a decisão
é do usuário.** Nada que altere estado passa pelo modelo.

| # | Regra | Onde vive |
|---|---|---|
| **INV-13** | Todo número nasce do cálculo determinístico; o modelo só **redige** | `insights/adherence.service.ts` |
| **INV-14** | Numeral que não está no cálculo **reprova** a redação | `insights/narration.guard.ts` |
| **INV-15** | Sem `ANTHROPIC_API_KEY` a API segue íntegra; `source` declara quem redigiu | `insights/narrator.ts` |
| **INV-16** | Chave, prompt integral e raciocínio do modelo nunca vão para resposta nem log | `insights/narrator.anthropic.ts` |
| **INV-17** | Tools MCP são somente leitura; escrever **não** é tool | `src/mcp/tools.ts` |
| **INV-18** | A IA nunca executa: reagendamento é proposta **assinada** aplicada só no confirm | `insights/proposal.service.ts` |
| **INV-19** | Proposta é sugestão, não autorização — o confirm revalida dono, hábito e dias | `insights/proposal.service.ts` |

INV-14 é a peça que não se resolve com prompt. Um modelo "generoso" que escreva
"você cumpriu 9 dos 12" quando o cálculo diz 8 de 12 passa por qualquer revisão
de estilo; o guarda extrai os numerais do texto e reprova o que não estiver no
relatório. A defesa é do código, não da instrução.

Por que o MCP é para assistente **externo** e não para a própria API se
consultar: o servidor MCP e o cliente MCP seriam o mesmo processo, e a API
passaria a chamar a si mesma pelo protocolo. As tools existem para o Claude
Desktop/Code ler hábitos e estatísticas — nenhuma delas escreve.

### Contrato com os clientes

O outro lado destas quatro vive em `habits-dashboard` e `habits-mobile`; a API é
quem produz o status que as dispara.

| # | Regra | Onde vive |
|---|---|---|
| **INV-20** | O token vive em exatamente um lugar por vez | dashboard `lib/api/auth.ts`; mobile `lib/api/auth.ts` |
| **INV-21** | **401** derruba a sessão e manda para o login, nos dois clientes | `lib/api/client.ts` nos dois |
| **INV-22** | **409** no check-in é duplicata, não erro para o usuário, nos dois clientes | dashboard `hooks/useHabits.ts`; mobile `store/habits.store.ts` |
| **INV-23** | O token do mobile mora no Keychain/Keystore, nunca em AsyncStorage | mobile `lib/api/auth.ts` |
| **INV-24** | NativeWind 4 exige Tailwind 3 | mobile `package.json` |

## Comandos de validação

Duas camadas, por dependência externa. Rode a maior que o ambiente permitir e
**declare no relatório final qual não rodou** — silenciar isso é reportar verde
falso.

**Camada 1 — sem dependência externa.** Mínimo obrigatório de qualquer alteração;
roda em qualquer sandbox de agente.

```bash
./scripts/check-agent-docs.sh
npx tsc --noEmit          # tsup NÃO checa tipo: só isto pega erro de tipo
npm run lint              # --max-warnings=0
npm run test:unit
```

Três armadilhas que já custaram tempo, detalhadas em `docs/DECISOES.md`:

- **`npm run build` passa com erro de tipo** — `tsup` não typecheca. Rode `tsc --noEmit`.
- **`src/mcp/tools.ts` importa de `zod/v4`**, não de `zod`, senão o `tsc` estoura o heap.
- **Migração precisa estar rastreada** — a checagem 8 do gate confere disco vs índice.

**Camada 2 — exige PostgreSQL.** Apaga as três tabelas antes de cada teste, então
roda em banco **separado** (`habits_test`, de `.env.test`), e `tests/setup.ts`
**recusa** qualquer banco cujo nome não termine em `_test`.

```bash
npm run docker:up
npm run db:test:create && npm run db:test:migrate
npm run test:integration
```

**Camada 3 — exige a stack de pé.** Sobe a imagem e bate nela por HTTP. É a única
que prova que o **container funciona** — o Dockerfile daqui já produziu container
em loop de reinício sem nada perceber.

```bash
docker compose up --detach --build --wait
./scripts/smoke.sh
```

O smoke vive em `scripts/smoke.sh`, não embutido no workflow, para haver **uma
cópia** — rodável no CI e aqui. Embutir no YAML garante duas versões divergindo
em silêncio.

**Camada 3.5 — o repositório reproduz?** As outras testam o código; esta testa o
**repositório**. `git archive HEAD` entrega só o rastreado, sobe em projeto e
porta próprios, e roda o smoke contra o clone. Fora do CI de propósito: lá todo
checkout já é clone limpo. Ver `docs/DECISOES.md`.

```bash
npm run verify:repro
```

`npm run verify` roda a Camada 1 e tenta as outras duas. O que não puder rodar
**avisa em vez de falhar**, mas o script sai com **código 3**, para que automação
que só lê o exit status não confunda "pulou" com "passou". A Camada 3 não sobe a
stack sozinha: `docker compose up --build` leva minutos e derrubar o que já
estava rodando seria surpresa desagradável.

### Ferramentas exigidas

| Ferramenta | Versão | Como conferir |
|---|---|---|
| Node | **22** (o do CI) | `node --version` |
| Docker | daemon **em execução**, não só o cliente | `docker info` |
| `jq` | qualquer | `jq --version` |
| `git archive` | do próprio git | `git archive --format=tar HEAD \| tar -t \| head -1` |

`docker --version` responde com o daemon desligado. Só `docker info` prova que as
Camadas 2 e 3 são executáveis.

## Definição de pronto

- Cada invariante tocada tem teste que cita o número no nome.
- Invariante nova entra na tabela acima **com** o arquivo onde vive.
- Toda invariante tem também um teste **adversário**: um que tenta violá-la e
  exige que seja barrada. Teste de caminho feliz não prova fronteira.
- O fluxo manual continua funcionando sem `ANTHROPIC_API_KEY`.
- Nenhum teste aponta para banco fora de `*_test`.
- O relatório final declara qual camada rodou e qual não rodou, com o motivo.
- Rota nova que mude estado ou exponha dado entra no `scripts/smoke.sh`.
- Arquivo novo que a aplicação precise para subir está **rastreado** — a Camada
  3.5 é o que prova, e a checagem 8 do gate é o que impede a regressão.

## Risco e revisão

- **Baixo:** texto, documentação, Swagger. Gates automáticos bastam.
- **Médio:** CRUD, schemas Zod, contratos de resposta. Revisar contrato e teste.
- **Alto:** migrations, cálculo de aderência, autenticação, **toda a camada de
  IA**, e `Dockerfile`/`docker-compose.yml` — a imagem só é exercitada pela
  Camada 3. Revisão humana integral; use plan mode antes de editar.
