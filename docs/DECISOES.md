# Decisões arquiteturais

Só decisões com trade-off real, e o que se perdeu em cada uma. O que a
arquitetura **é** está em [ARQUITETURA.md](ARQUITETURA.md); as regras estão em
[AGENTS.md](../AGENTS.md).

## O dia é UTC, não o fuso do servidor

A coluna `checkins.date` é `@db.Date` e o Prisma a devolve como meia-noite UTC. O
código comparava essas datas com `setHours(0,0,0,0)`, que é meia-noite **local**.
Em qualquer fuso à frente de UTC o mesmo check-in caía no dia anterior, e a regra
"um check-in por hábito por dia" passava a depender de onde o processo rodava. Em
UTC−3 o defeito era invisível — o que o tornava pior.

Tudo em `utils/helpers.ts` usa `getUTC*`/`Date.UTC` por isso.

**O que se perdeu:** para quem está em UTC−3, o "dia" do hábito vira 21h do dia
anterior às 21h. Aceitável para um app de hábitos, e explícito, em troca de uma
regra que não depende de infraestrutura. Um fuso por usuário resolveria melhor, e
não existe — está registrado como lacuna, não como decisão.

## A garantia de um check-in por dia é do banco

O service consulta antes de gravar, mas essa consulta corre em transação separada
e **perde para dois pedidos simultâneos**. A garantia é `@@unique([habitId, date])`.

A consulta prévia existe só para devolver 409 com mensagem em vez de erro de
constraint cru. Quando ela perde a corrida, o `P2002` do Prisma é traduzido para
o mesmo 409: antes, o vencedor recebia 201 e o perdedor 500 — mesmo caso de
negócio, resposta diferente por acidente de tempo.

## Aderência é medida contra dias agendados

`completionRate` dividia por 30 fixo. Um hábito de segunda, quarta e sexta
cumprido à risca marcava ~43% e parecia negligência.

Agora o denominador é a contagem de dias **agendados** na janela, e a janela nunca
começa antes da criação do hábito — antes, um hábito criado ontem e cumprido
aparecia com ~3%.

**O que se perdeu:** `HabitStats` cresceu quatro campos (`windowDays`,
`scheduledDaysInWindow`, `completedInWindow`, `extraCheckins`). São aditivos, e
existem para que quem apresenta o número não precise recalcular nada — "70%" sem
saber sobre quantos dias é um número sem sentido, e a redação por IA precisa do
denominador para ser precisa.

## Check-in em dia não agendado é aceito, e não conta

Fazer a mais nunca é erro, então o check-in é gravado. Mas ele não entra na taxa:
vai para `extraCheckins`. Se entrasse no numerador, quem cumpre só terças num
hábito de segundas teria aderência sem nenhum compromisso cumprido — e a taxa
poderia passar de 100%.

Ele também não emenda sequência: o compromisso era outro dia.

## A sequência pula dia não agendado

`calculateStreak` conta só dias agendados. Quem se compromete com segunda, quarta
e sexta e cumpre as três tem sequência 3, não 1 — antes, terça e quinta
"quebravam" uma sequência que ninguém havia prometido.

A assinatura é `calculateStreak(dates, scheduledDays?)`: sem o segundo argumento,
o comportamento é o de calendário, idêntico ao anterior. Compatibilidade
deliberada, para que a mudança de semântica seja uma escolha de quem chama.

Hoje tem carência: se hoje é dia agendado e ainda não houve check-in, a sequência
é contada até o dia agendado anterior em vez de zerar. O dia ainda não terminou.

## `scheduledDays` vazio significa "todo dia"

É o default do schema e o comportamento de todo hábito criado antes de o
agendamento existir. Nenhuma migração de dado foi necessária.

A consequência incômoda está no motor de reagendamento: hábito "todo dia" não é
reagendável, porque remover dias de um conjunto vazio exigiria primeiro escolher
os sete, e o sinal de falha por dia da semana não sustenta essa decisão.

## Duas camadas de teste, não uma suíte

`npm test` rodava tudo junto, inclusive três arquivos que exigem PostgreSQL. Em
máquina sem Docker o comando falhava inteiro, sem distinguir "quebrou" de "não
pôde rodar" — e o hábito que isso cria é parar de rodar testes.

Agora Camada 1 (`test:unit`) roda em qualquer lugar e Camada 2
(`test:integration`) exige banco. `verify.sh` roda a 1, tenta a 2, e sai com
**código 3** quando a 2 não pôde rodar: automação que só lê o exit status não
confunde "pulou" com "passou".

## A Camada 2 tem banco próprio, e a trava é uma exceção

Ela apaga as três tabelas antes de cada teste. A primeira versão usava o
`DATABASE_URL` do `.env` — o banco de desenvolvimento. Rodar a suíte apagaria os
hábitos reais de quem estivesse trabalhando, em silêncio, com a saída do jest
parecendo perfeitamente normal.

Agora o banco vem de `.env.test` (`habits_test`), carregado com `override: true`
para que nem um `DATABASE_URL` exportado no shell redirecione a suíte. E
`tests/setup.ts` **recusa** rodar se o nome não terminar em `_test`.

Por que exceção e não aviso: aviso em saída de teste é lido depois do estrago. E
por que a trava mora em `tests/lib/` e não em `setup.ts`: para ter teste próprio
na Camada 1. Uma trava sem teste é a pior espécie — dá sensação de proteção e
ninguém verifica se o `_test$` ancorado no fim não virou um `includes('_test')`,
que aceitaria `habits_test_backup`.

## `tsc --noEmit` é passo obrigatório

`npm run build` usa `tsup`, que **não** checa tipo. Havia doze erros de tipo
invisíveis no `src`, incluindo uma chamada de service com dois argumentos onde
o método pede três — em um método de controller que nenhuma rota apontava.

O typecheck é passo separado no `verify.sh` e no CI por isso.

E um detalhe que só aparece com o typecheck ligado: `src/mcp/tools.ts` importa de
`zod/v4`, não de `zod`. O SDK do MCP 1.30 é tipado contra a API v4 do Zod;
passando esquemas da v3 clássica — que é o export default do `zod@3.25` — a
resolução de overload do `registerTool` fica profunda o bastante para **estourar
o heap do `tsc`** (TS2589), e o comando morre em vez de reportar erro. As duas
APIs convivem no mesmo pacote, e esse é o único arquivo que fala com o SDK.

## Camada 3.5: o repositório é uma propriedade separada do código

As Camadas 1, 2 e 3 testam **o código**. Nenhuma testava **o repositório**.

A diferença apareceu do pior jeito: `.gitignore` mantinha
`prisma/migrations/**/migration.sql` fora do git. As três camadas passavam na
estação de trabalho — os arquivos existem no disco — e o CI falhava, porque
`prisma migrate deploy` num clone não encontrava migração nenhuma e **saía com
código 0**. Container subia, reportava healthy, e devolvia 500 em toda rota de
dado.

Eu havia apresentado a Camada 3 como "a única coisa que prova que a imagem
funciona". Ela prova que a imagem funciona **com o disco presente**. Que um clone
produza a mesma coisa é outra propriedade, e nenhuma camada a cobria.

`scripts/verify-repro.sh` usa `git archive HEAD`, que entrega exatamente o que um
clone entrega: só o rastreado. Sobe em projeto e porta próprios — sem colidir com
a stack de desenvolvimento — e roda o mesmo smoke contra o clone. Verificado que
pega o defeito original: removendo as migrações do índice, ela falha na primeira
checagem, antes de construir nada.

Não está no CI porque lá todo checkout já é clone limpo. O que está no CI é a
checagem 8 do `check-agent-docs.sh`, que compara migrações no disco com migrações
no índice — a classe inteira pelo caminho mais barato, no job de 4 segundos.

**Por que corrigir a classe e não o caso:** versionar os dois arquivos com
`git add -f` deixaria a regra do `.gitignore` escondendo a próxima migração, que
nasceria ignorada e sairia do commit sem aparecer no `git status`. E o modo de
falha seria **pior** que o original: com migrações antigas rastreadas, o clone
aplica o esquema desatualizado e sobe, falhando só no campo que existe num disco
só. Trocar falha ruidosa por falha silenciosa é regressão disfarçada de correção.

## O healthcheck consulta o banco

`/health` respondia 200 checando só se o processo estava vivo. O container se
declarou `healthy` para o `docker compose --wait` com zero tabelas: liveness
vendido como readiness.

Agora consulta `prisma.user.findFirst({ select: { id: true } })`, que prova
conexão, tabela e coluna. `findFirst` e não `count()`: os dois provam o mesmo, mas
`count()` é `SELECT COUNT(*)` e paga um scan da tabela inteira a cada chamada —
num endpoint que orquestrador consulta a cada poucos segundos, para sempre.

Tem timeout de 2s, porque banco que aceita conexão e não responde penduraria o
`await` retendo a conexão em vez de devolver 503. Healthcheck que não responde
rápido é healthcheck que falhou.

**O que se perdeu:** o endpoint é público e sem limite de taxa, e agora cada
chamada consome uma conexão do pool. Antes era `process.uptime()`, custo zero. Um
flood trivial esgota o pool e derruba as rotas autenticadas. Isso muda o status do
rate limit: ele deixou de ser paridade com a régua do NotaFlow e passou a ser
**pré-requisito de duas correções já aplicadas** — esta e a paralelização de
`getProposals`, que trocou latência somada por pressão de concorrência. Está
registrado como lacuna em `docs/CHECKLIST-DE-ACEITE.md`.

## A IA nunca decide, e funciona sem chave

Detalhado em [IA.md](IA.md). O resumo: o cálculo é determinístico e o modelo só
redige; um guarda numérico reprova texto que cite número fora do relatório; o
reagendamento é proposta assinada que só o `confirm` aplica; e sem
`ANTHROPIC_API_KEY` um redator determinístico assume, por composição e não por
condicional.

**O que se perdeu com a proposta assinada:** antes da camada existir, a IA não
podia causar dano porque não havia caminho de escrita. Agora o argumento é
"confiamos na assinatura e na revalidação do confirm". É mais fraco, e por isso
os controles são obrigatórios e cada um tem teste adversário.

## Convenção dos arquivos de contexto de agente

`AGENTS.md` é canônico; `CLAUDE.md` só o importa. Regra em `.claude/rules/` o
Codex não lê; regra em `AGENTS.md` de subpasta o Claude Code não lê — instrução
dividida por ferramenta é instrução que metade dos agentes não recebe.

`scripts/check-agent-docs.sh` verifica a convenção, e tem uma checagem que o
script do NotaFlow não tem: **invariante declarada sem teste que a cite pelo
número reprova o gate**. Sem ela, a tabela cresce e a cobertura não.

## Por que cada camada de validação existe

O `AGENTS.md` lista os comandos; as razões ficam aqui, porque explicação lá custa do
teto de prosa e regra sem explicação é preferência de estilo. Foi movido para cá por
escolha, e não quando o gate reprovou — que é a diferença entre organizar e ceder.

### Camada 3 é a única que prova o container

O `Dockerfile` deste repositório já produziu **container em loop de reinício sem
nada perceber**: seis defeitos empilhados (node 18-alpine com o engine de OpenSSL
errado, sem migração no boot, `JWT_SECRET` de 25 caracteres contra o mínimo de 32 do
Zod, sem healthcheck do Postgres, mounts de fonte sobre o `dist/`, e root).

Camadas 1 e 2 carregam a aplicação **em processo**, com o `.env` de quem roda. Nenhum
dos seis aparecia ali. É por isso que a Camada 3 não é redundante com a 2 — ela
testa um artefato diferente.

E foi ela que achou `DATABASE_URL_READONLY` ausente do compose: a migração criava a
role e o RLS, o banco da imagem tinha tudo, e a primitiva `query` simplesmente não
era registrada. Sintoma: `Tool query not found`.

### O smoke vive num script, não no workflow

**Uma cópia**, rodável nos dois lugares. Embutir os passos no YAML garante duas
versões divergindo em silêncio — e a divergência é invisível justamente porque as
duas "passam", cada uma testando algo levemente diferente.

É a mesma razão da checagem 9 do gate documental, que compara os comandos `npm` do
workflow com os do `verify.sh`.

### O `verify` sai com código 3, e a Camada 3 não sobe a stack sozinha

**Código 3** para "alguma camada não pôde rodar", distinto de 0 e de 1: automação
que só lê exit status não deve confundir "pulou" com "passou". Verde falso é pior
que vermelho, porque encerra a investigação.

E a Camada 3 **não** sobe a stack por conta própria: `docker compose up --build`
leva minutos e derrubaria a stack de quem chamou. Ela avisa e pula. O `CLAUDE.md`
repete isso porque é o tipo de coisa que um agente faz sem perguntar.

### O `verify` grava tudo em `.verify.log`

Um flake ficou sem diagnóstico porque um `grep` do turno descartou o nome do teste
que falhou. **Filtre a exibição, nunca a captura** — e a regra se pagou na primeira
reincidência, quando o mesmo flake voltou e o log tinha o nome. Ver
`docs/LICOES.md`.
