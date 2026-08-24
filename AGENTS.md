# AGENTS.md

## Objetivo

`habits-api` é o hub do ecossistema Habits: dashboard e mobile consomem os mesmos
endpoints em `/api/v1`. A prioridade é que o registro de hábitos seja exato e
recuperável; a IA é assistiva e **nunca executa sozinha**.

**Recuperável vale para exclusão e para edição** — por mecanismos diferentes: soft
delete com `/restore`, e histórico de versões com `/revisions/:id/restore`. Edição
ficou de fora até a migração `historico_de_edicao`, e a assimetria só foi percebida
quando as primitivas do MCP a tornaram alcançável por composição.

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

INV-14 não se resolve com prompt: o guarda extrai os numerais e reprova o que não
está no relatório, e o que ele **não** prova está declarado em
`narration.guard.ts`. O MCP é para assistente **externo**. Detalhes em `docs/IA.md`.

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
| **INV-29** | Toda tabela está classificada: exposta com RLS, ou não exposta com motivo | `src/mcp/tabelas.ts` |
| **INV-30** | Execução arbitrária tem teto de **frequência** e de **simultaneidade** | `middlewares/rate-limit.middleware.ts` |
| **INV-31** | Toda edição grava a versão anterior, e restaurar grava também | `repositories/habits.repository.ts` |
| **INV-32** | O purge exporta e **conta** tudo que o CASCADE destrói | `scripts/purge.ts` |
| **INV-33** | O servidor de teste da primitiva usa porta **fora** da faixa efêmera | `tests/lib/porta-fixa.ts` |

INV-27 falha **fechada** (sem a variável de sessão, zero linhas) e tem duas barreiras,
as duas do banco: gramática e permissão. INV-29 é INV-26 aplicada ao banco — tabela nova
nasce inacessível. INV-31 zerou `ALCANCE_TEM_IRREVERSIVEL`, e por `destructiveHint` ser **derivada**
dela ninguém teve de mudar as duas. INV-32 vigia a única barreira do purge — uma
pessoa lendo um resumo — e ela precisa nomear cada tabela que o cascade leva.
INV-33 fecha um flake: o pool keep-alive do `fetch` guarda socket para porta
efêmera morta, e o SO recicla essas portas. Fora da faixa, a colisão é impossível.
Detalhes e ausências declaradas em `docs/PRIMITIVAS.md`.

### Assistente conversacional

O chat do dashboard usa as MESMAS primitivas do MCP, com uma diferença que é o
desenho: `agir` **não executa** — propõe. No MCP o cliente é o Claude Code, que
tem confirmação própria; aqui não há, e sem a parada a fronteira dependeria do
prompt. Detalhes em `docs/ASSISTENTE.md`.

| # | Regra | Onde vive |
|---|---|---|
| **INV-34** | Leitura executa; escrita **para** e vira ação pendente que só a pessoa converte | `assistant/assistant.service.ts` |
| **INV-35** | Toda chamada ao modelo é registrada — tokens, duração, desfecho; **nunca** conteúdo | `prisma/schema.prisma` → `AiCall` |
| **INV-36** | Teto diário de tokens recusa **antes** de chamar o modelo | `assistant/orcamento.ts` |
| **INV-37** | Variável que o `env.ts` lê chega ao container, com o **mesmo** default | `docker-compose.yml` |
| **INV-38** | A superfície do chat **não tem** tool de escrita; `propor` grava, não executa | `src/mcp/tools-assistente.ts` |
| **INV-39** | A superfície **nativa** do subprocesso é vazia: só tools MCP | `src/assistant/motor-cli.ts` |
| **INV-40** | `ai_calls` tem retenção por idade; o agregado mensal sobrevive | `scripts/reter-telemetria.ts` |
| **INV-41** | Todo **executor** está classificado: quem, com que credencial, qual superfície | `src/config/executores.ts` |

INV-34 confere a allowlist duas vezes, e a que conta é a da **aprovação**: entre
propor e aprovar passam minutos, e o que vale é a lista do momento da execução.
INV-35 é a auditoria que `docs/PRIMITIVAS.md` declarava ausente. As rotas do próprio
assistente estão **negadas** na allowlist: recursão. INV-37 nasceu de três variáveis
que chegaram ao `.env` e não ao compose — ver `docs/LICOES.md`.

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

Três armadilhas desta camada estão em `docs/DECISOES.md`.

**Camada 2 — exige PostgreSQL.** Roda em banco **separado** (`habits_test`);
`tests/setup.ts` recusa nome que não termine em `_test`.

```bash
npm run docker:up
npm run db:test:create && npm run db:test:migrate
npm run check:schema-drift    # migrações versionadas == schema.prisma?
npm run test:integration
npm run test:integration:tz   # a MESMA suíte num fuso 17h deslocado
```

**Camada 3 — exige a stack de pé.** A única que prova que o **container funciona**.

```bash
docker compose up --detach --build --wait
./scripts/smoke.sh
```

O smoke vive em `scripts/smoke.sh` e não no workflow: **uma cópia**, rodável nos dois
lugares.

**Camada 3.5 — o repositório reproduz?** Testa o **repositório**, via `git archive
HEAD`. Fora do CI, onde todo checkout já é limpo.

```bash
npm run verify:repro
```

`npm run verify` roda a Camada 1 e tenta as outras; o que não puder rodar avisa e sai
com **código 3**, para automação não confundir "pulou" com "passou". Grava tudo em
`.verify.log`. As razões de cada camada estão em `docs/DECISOES.md`.

Ferramentas e versões exigidas: `docs/FERRAMENTAS.md`.

## Definição de pronto

- Cada invariante tocada tem teste que cita o número no nome.
- Invariante nova entra na tabela acima **com** o arquivo onde vive.
- Toda invariante tem também um teste **adversário**: um que tenta violá-la e
  exige que seja barrada. Teste de caminho feliz não prova fronteira.
- **O gate local roda o que o CI roda.** A checagem 9 compara os comandos `npm` do
  workflow com o `verify.sh` — o workflow é a fonte, o script é o derivado. Duas
  listas sem nada comparando foi como `npm install` e `npm ci` conviveram.
- **Verificação nova tem caso vizinho.** Construa o caso que o gate **deveria** pegar
  e veja-o pegar — não o que o motivou, que já passa por construção. Vale para gates.
- **Ancore em sumário, nunca em substring de saída livre.** Asserção sobre recusa
  exige a RAZÃO da recusa; contagem de falha exige `^Tests: +N failed`.
- **Filtre a exibição, nunca a captura.** `cmd 2>&1 | tee log | grep …`. O
  `verify.sh` grava tudo em `.verify.log`.
- **Calibre instrumento novo contra resultado conhecido**, e reproduza no ambiente
  que vale — o mais permissivo **esconde** defeito.
- **Asserção sobre EFEITO, nunca sobre chamada.** Vale em dobro para sugestão de
  revisor não medida.

Os treze defeitos que produziram essas cinco regras, cada um com o que ele fez e como
foi pego, estão em `docs/LICOES.md`. Aqui ficam as regras; lá fica o porquê.

- **`git commit` em `main`/`master` é recusado por hook.** `npm run hooks:install`
  instala `scripts/hooks/pre-commit`. Hook não é clonado, então a instalação é passo
  explícito — e a regra deixa de depender de conferir o branch.
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
