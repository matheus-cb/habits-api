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
| **INV-17** | Tool **nomeada** é somente leitura; escrita só pela primitiva `request` | `src/mcp/tools.ts` |
| **INV-18** | A IA nunca executa: reagendamento é proposta **assinada** aplicada só no confirm | `insights/proposal.service.ts` |
| **INV-19** | Proposta é sugestão, não autorização — o confirm revalida dono, hábito e dias | `insights/proposal.service.ts` |

INV-14 não se resolve com prompt — o guarda extrai os numerais e reprova o que não está
no relatório; o que ele **não** prova está em `narration.guard.ts`. Ver `docs/IA.md`.

### Primitivas do MCP

O assistente **compõe** as chamadas em vez de escolher entre tools prontas: o
guardião deixa de ser a ausência de método e passa a ser permissão de banco,
política de linha e allowlist fechada. Por quê e a que custo: `docs/PRIMITIVAS.md`.

| # | Regra | Onde vive |
|---|---|---|
| **INV-25** | A superfície anunciada é a declarada, e só **uma** tool escreve | `src/mcp/primitivas.ts` |
| **INV-26** | Toda rota do Express está classificada: permitida ou negada, com motivo | `src/mcp/request.ts` |
| **INV-27** | `query` não escreve por **permissão** e não vê dado alheio por **RLS** | `src/mcp/query.ts` |
| **INV-28** | Escrita do assistente é marcada na origem, e o delete é sempre **lógico** | `src/mcp/origem.ts`, `src/config/soft-delete.ts` |

INV-27 falha **fechada**: sem a variável de sessão a política devolve zero linhas, não
tudo. INV-28 nunca sub-registra e às vezes sobre-registra — a assimetria que a torna
aceitável está em `origem.ts`.

### Contrato com os clientes

O outro lado destas cinco vive em `habits-dashboard` e `habits-mobile`; a API é quem
produz o status que as dispara.

| # | Regra | Onde vive |
|---|---|---|
| **INV-20** | O token vive em exatamente um lugar por vez | dashboard `lib/api/auth.ts`; mobile `lib/api/auth.ts` |
| **INV-21** | **401** derruba a sessão e manda para o login, nos dois clientes | `lib/api/client.ts` nos dois |
| **INV-22** | **409** no check-in é duplicata, não erro para o usuário, nos dois clientes | dashboard `hooks/useHabits.ts`; mobile `store/habits.store.ts` |
| **INV-23** | O token do mobile mora no Keychain/Keystore, nunca em AsyncStorage | mobile `lib/api/auth.ts` |
| **INV-24** | NativeWind 4 exige Tailwind 3 | mobile `package.json` |

## Comandos de validação

Quatro camadas, por dependência externa. Rode a maior que o ambiente permitir e
**declare no relatório final qual não rodou** — silenciar isso é reportar verde falso.

**Camada 1 — sem dependência externa.** Mínimo obrigatório de qualquer alteração;
roda em qualquer sandbox de agente.

```bash
./scripts/check-agent-docs.sh
npm ci --dry-run          # valida peers como o CI faz; `npm install` não
npx tsc --noEmit          # tsup NÃO checa tipo: só isto pega erro de tipo
npm run lint              # --max-warnings=0
npm run test:unit
```

Três armadilhas, em `docs/DECISOES.md`: `build` passa com erro de tipo; `src/mcp/` e
`src/schemas/` importam de `zod/v4` ou o `tsc` estoura o heap; migração precisa estar
rastreada **e** atualizada (checagem 8 do gate mais `check:schema-drift`).

**Camada 2 — exige PostgreSQL.** Apaga as três tabelas, então roda em banco
**separado** (`habits_test`, de `.env.test`); `tests/setup.ts` recusa qualquer nome
que não termine em `_test`.

```bash
npm run docker:up
npm run db:test:create && npm run db:test:migrate
npm run check:schema-drift    # migrações versionadas == schema.prisma?
npm run test:integration
```

**Camada 3 — exige a stack de pé.** Sobe a imagem e bate nela por HTTP. É a única
que prova que o **container funciona** — o Dockerfile daqui já produziu container
em loop de reinício sem nada perceber.

```bash
docker compose up --detach --build --wait
./scripts/smoke.sh
```

O smoke vive em `scripts/smoke.sh`, não no workflow: **uma cópia**, rodável nos
dois lugares. Embutir no YAML garante duas versões divergindo em silêncio.

**Camada 3.5 — o repositório reproduz?** As outras testam o código; esta testa o
**repositório**, via `git archive HEAD` — fora do CI, onde todo checkout já é limpo.

```bash
npm run verify:repro
```

`npm run verify` roda a Camada 1 e tenta as outras. O que não puder rodar **avisa em
vez de falhar** e o script sai com **código 3**, para automação não confundir "pulou"
com "passou". A Camada 3 não sobe a stack sozinha: leva minutos e derrubaria a de
quem chamou.

Ferramentas e versões exigidas: `docs/FERRAMENTAS.md`.

## Definição de pronto

- Cada invariante tocada tem teste que cita o número no nome.
- Invariante nova entra na tabela acima **com** o arquivo onde vive.
- Toda invariante tem também um teste **adversário**: um que tenta violá-la e
  exige que seja barrada. Teste de caminho feliz não prova fronteira.
- **O gate local roda o que o CI roda.** A checagem 9 compara os comandos `npm` do
  workflow com o `verify.sh` — o workflow é a fonte, o script é o derivado. Duas
  listas sem nada comparando foi como `npm install` e `npm ci` conviveram.
- **Verificação nova tem caso vizinho.** Depois de escrever um gate, uma trava ou
  um guarda, construa o caso que ele **deveria** pegar e veja-o pegar — não o caso
  que motivou escrevê-lo, que já passa por construção. "Toda invariante tem teste
  adversário" vale para os gates também, e é onde ninguém pensa em aplicar: gate
  não é código de produção. Nove defeitos desta safra eram verificações que
  funcionavam no caso de origem e olhavam para a metade errada.
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
