# O que está aberto

Este arquivo existe porque uma sessão de trabalho longa produz decisões e
limitações que ficam **só na conversa** — e conversa não sobrevive a um `/clear`.
Cada item aqui está aberto de propósito, com quem decide e o que já foi medido.

Não é lista de tarefas. É o registro do que **não** está resolvido, para ninguém
supor que está.

## Decisões que são do Matheus

### `POST /auth/register` é aberto

Qualquer pessoa com acesso à API cria conta. E toda mensagem do chat consome a
assinatura do Claude Code (ou a chave da Anthropic) de quem configurou o servidor.

Hoje é local e inofensivo. **No dia em que a API sair desta máquina, é o primeiro
item a fechar** — antes de qualquer outro, porque o custo é de quem hospeda e o
acesso é de quem souber a URL.

Três saídas, e nenhuma é obviamente certa: convite por lista fechada, registro
desabilitado com contas criadas por script, ou teto de custo que se aplique também
a quem nunca conversou.

### O escopo do teto de custo é POR USUÁRIO

`orcamentoDoDia(userId)` filtra por identidade (INV-36). A consequência: **N
usuários multiplicam o gasto** na conta de quem configurou o motor.

A alternativa — teto global — trocaria isso por um usuário conseguir esgotar o dia
de todos, negação de serviço por poucos dólares. Nenhuma das duas é errada, e a
escolha atual é a que está no código. Registrada aqui porque a decisão é dele e não
estava em lugar nenhum.

### O deploy não existe

`docs/DEPLOY.md` é um **guia manual**, não um pipeline. Verificado:

- não há `railway.json`, `vercel.json`, `fly.toml` nem nada equivalente
- nenhuma CLI de deploy instalada
- o workflow do CI **só valida**, não publica
- `https://habits-api-production.up.railway.app/health` responde **404** — não há
  nada publicado

Publicar exige `railway login`, que é autenticação em serviço terceiro e é dele.
O que se pode preparar sem isso: os arquivos de configuração e um job de deploy no
workflow disparado por push no `master`.

## Limitações medidas, e que não dá para fechar aqui

### Todas as medições de custo e latência são do motor CLI

Custo, latência, a escolha do Sonnet, as onze voltas do Haiku — tudo medido no
motor que roda sobre `claude -p`. **Esse é o motor que não vai para produção.**

Em produção roda o SDK: contexto diferente (não relê ~32k tokens por volta), custo
diferente, caminho de código diferente. **O teto diário em dólares foi calibrado no
motor errado.**

Não há medição do SDK porque não há `ANTHROPIC_API_KEY` nesta máquina, e estimar
seria inventar. A primeira coisa a fazer quando houver uma chave é medir uma
pergunta pelo SDK e pôr os dois números lado a lado.

### O motor CLI não roda em container nem em produção

O `claude` precisa estar instalado e autenticado na máquina do processo, e a
credencial vive no keychain de quem instalou. Isso torna o chat, hoje, um recurso
de desenvolvimento — e a interface não diz isso.

## Ausências declaradas, com o motivo

### Streaming token a token

O SSE emite por bloco: no motor da API o texto sai quando a volta termina, e no CLI
quando o subprocesso termina. A API suporta stream de verdade
(`content_block_delta`), e o CLI tem `--output-format stream-json`. Os dois são
trabalho, e nenhum é bloqueante.

### Custo em dinheiro para o motor da API

`ai_calls.costUsd` é preenchido pelo CLI, que devolve `total_cost_usd` calculado. O
SDK devolve tokens, e converter exigiria tabela de preço por modelo — que muda.
Preço desatualizado escrito no banco é pior que ausente.

### Retenção de `habit_revisions` e `conversation_messages`

**Deliberadamente sem política**, e o motivo é o oposto do de `ai_calls`: as duas
guardam conteúdo que a pessoa pode querer daqui a um ano, e descartar por idade
apaga exatamente o que se quer recuperar de um erro antigo.

Se doer, o corte certo é **dedupe de revisão idêntica à anterior** — um `PUT` que
não mudou nada grava uma linha que não significa nada. Dedupe, não expiração.

`ai_calls` tem retenção (INV-40) porque é o inverso nos três eixos: o valor decai, o
volume cresce com uso, e nada nela é recuperável.

### `paths` do OpenAPI está vazio

`swaggerDocument` tem `paths: {}` e é servido em `/api-docs` desde sempre. O
contrato que vale é `habits://contratos`, derivado dos schemas Zod. Preencher
`paths` a partir da mesma derivação é o conserto de verdade; escrever à mão
recomeçaria o apodrecimento.

### Sem teste de que o prompt produz boas decisões

Os casos de INV-34 a INV-40 provam as fronteiras com cliente dublado: que a escrita
para, que a RLS isola, que o teto recusa, que a superfície nativa é vazia. **Nenhum
prova que o assistente é útil**, e isso não é verificável por teste automático.

### Sem teste de componente nas telas novas

`InsightsPage`, `AssistantPage`, `ProposalCard`, `ActionCard` e `HabitHistoryModal`
não têm teste de renderização — como o resto das páginas do dashboard. Os contratos
com a API e o parse do SSE têm.

## Verificado e fechado — não reabrir sem medir

Registrado porque cada um destes já foi suposto errado uma vez, e a suposição custa
tempo:

- **Reaproveitar a sessão do CLI não barateia.** `--resume` mediu MAIS caro que
  abrir nova ($0.2475 → $0.3261). O custo é por volta de ferramenta; cada volta
  relê ~32k tokens. O que a sessão dá é o fio da conversa.
- **`--allowedTools` não restringe superfície** — é auto-aprovação. A flag que
  restringe é `--tools` (INV-39).
- **Haiku é o pior dos três modelos.** Mais barato por token e mais caro por
  resposta, porque erra e repete: 11 voltas contra 4.
- **O subprocesso precisa de `USER`** além de `HOME` e `PATH`. Sem ela o CLI diz
  `Not logged in`, porque a credencial vive no keychain e ele resolve o usuário por
  `USER`.
- **A mensagem `[sistema]` da retomada é texto FIXO**, sem interpolação de dado do
  usuário. Não há caminho por onde conteúdo controlado pelo usuário entre no
  contexto com autoridade de sistema.

## O flake de `ECONNRESET`

**Classe fechada, causa da primeira ocorrência não estabelecida.**

Sockets do pool do `fetch` sobrevivem ao fechamento do servidor de teste — medido,
determinístico. Isso produz `ECONNRESET` de forma reproduzível, e está corrigido em
três frentes: porta fixa **por arquivo** fora da faixa efêmera, retry único
restrito a `GET` classificando falha de transporte pela classe, e drenagem dos
fechamentos do MCP no teardown.

A causa da primeira ocorrência observada nunca foi estabelecida: ela apareceu duas
vezes, uma delas **sem o nome do teste** — o `grep` do turno o descartou. Se voltar,
`.verify.log` guarda o nome.
