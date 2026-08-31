# O assistente conversacional do dashboard

## O que ele é

Um chat dentro do Habits. Você escreve em português, ele consulta os seus dados e
responde — e quando quer **alterar** algo, ele para e pede.

Não é o mesmo que o MCP. São duas superfícies para o mesmo motor:

| | MCP | Chat do dashboard |
|---|---|---|
| Cliente | Claude Code / Claude Desktop | o próprio dashboard |
| Quem paga | a assinatura de quem conversa | assinatura do Claude Code ou `ANTHROPIC_API_KEY` |
| Confirmação de escrita | o cliente MCP tem a dele | **ação pendente**, no banco |
| Precisa de chave? | não | não quando a ponte privada do Claude Code está configurada |

## Como a fronteira funciona aqui

O modelo vê duas ferramentas:

- **`consultar`** — SELECT nos dados de quem conversa. Executa na hora.
- **`agir`** — **propõe** uma escrita. Não executa.

Quando ele chama `agir`, o laço **termina**. Nasce uma linha em `pending_actions`
com o método, o caminho, o corpo e um resumo em português. A interface mostra um
cartão; você aprova ou recusa. Só a aprovação executa, e ela reconfere a allowlist.

Por que a parada existe, dito sem enfeite: **no MCP ela não é necessária** porque o
Claude Code mostra a chamada e espera aprovação. O dashboard não tem esse
mecanismo. Sem a parada, "a decisão é do usuário" dependeria de o modelo obedecer ao
prompt — e prompt não é garantia.

Depois de decidir, a conversa **retoma**: o resultado da escrita entra no histórico
como resultado de ferramenta e o modelo continua. Sem isso, aprovar seria um beco —
a escrita aconteceria e você teria de escrever "e agora?".

## Os quatro tetos, e o que cada um contém

| Trava | Valor | Contém |
|---|---|---|
| Tokens de saída por dia, por usuário | `ASSISTANT_DAILY_OUTPUT_TOKENS` (120.000) | custo |
| Voltas do laço por mensagem | `ASSISTANT_MAX_TURNS` (10) | laço infinito |
| Mensagens por minuto | 20, por usuário | rajada |
| Prazo de uma ação | `ASSISTANT_ACTION_TTL_MINUTES` (30) | aprovar coisa velha |

Nenhum cobre o outro: 20 mensagens curtas cabem no minuto e não estouram o dia; uma
mensagem que dê dez voltas estoura o dia sem chegar perto do minuto.

O teto diário recusa **antes** de chamar o modelo. Recusar depois cobraria a chamada
que excedeu — o teto seria "o teto mais uma mensagem".

## O registro, e o que ele NÃO guarda

Toda chamada ao modelo entra em `ai_calls`: modelo, tokens de entrada e saída,
número de ferramentas, duração e desfecho.

**Não guarda prompt nem texto do modelo** (INV-16). Auditoria de custo não precisa
de conteúdo, e guardar conteúdo transformaria a tabela de custo numa segunda cópia
da conversa — com outra política de retenção e outro alcance.

Essa tabela é a auditoria que `docs/PRIMITIVAS.md` declarava ausente. Ela era
aceitável enquanto o cliente era o Claude Code, que tem registro próprio e cuja
conta é de quem conversa. Com chat próprio, um laço mal conduzido gasta dinheiro do
servidor e ninguém saberia.

## Três motores, e a ordem é deliberada

| | Chave da API | Assinatura do Claude Code |
|---|---|---|
| Configuração | `ANTHROPIC_API_KEY` | `CLAUDE_CLI_PATH` |
| Custo por pergunta | ~$0.02 | **$0.17–0.20** (medido) |
| Tempo por pergunta | ~3s | **11–28s** (medido) |
| Roda no container | sim | **não** — o CLI não existe na imagem |
| Streaming | por bloco | resposta inteira no fim |

Em produção, a assinatura do Claude Code chega por uma **ponte privada no host**:
o container chama `CLAUDE_BRIDGE_BASE_URL`, autenticado por
`CLAUDE_BRIDGE_SECRET`; a ponte cria uma configuração MCP temporária que aponta
somente para `/mcp/assistente`. O binário, o `HOME` e a credencial OAuth nunca são
montados no container. A rota MCP é publicada apenas em `127.0.0.1:3334`, e a
ponte escuta apenas no gateway interno do Docker. Ela habilita exclusivamente
`consultar` e `propor`; ações continuam sendo linhas pendentes até o clique da
pessoa.

A chave ganha quando existe, e a ordem não é configurável: se há chave, use a
chave. Uma variável para inverter seria uma chance de rodar o caminho caro sem
querer.

### O modelo é Sonnet, e a escolha é medida

Mesma pergunta, mesmo prompt, mesmo motor:

| modelo | voltas | saída | custo | tempo |
|---|---|---|---|---|
| opus | 4 | 315 | $0.1661 | 9.5s |
| **sonnet** | 4 | 318 | **$0.0882** | 8.2s |
| haiku | 11 | 1528 | $0.1232 | 27.1s |

Sonnet custa **47% menos que Opus e responde igual**. Confirmado depois pelo
endpoint real: $0.080 contra $0.192 na mesma classe de pergunta.

E **Haiku é pior nos dois eixos** — não por ser mais barato por token, mas porque
erra e tenta de novo: onze voltas, e cada volta relê o contexto inteiro. O modelo
mais barato por token sendo o mais caro por resposta é o resultado que contraria a
intuição, e é por isso que a escolha está medida em vez de suposta.

`ASSISTANT_MODEL` vale para os dois motores — `--model` no subprocesso e `model` na
chamada do SDK. Um assistente que respondesse diferente dependendo do motor seria
dois assistentes.

A **redação** (resumo de aderência, justificativa das propostas) segue em Opus por
`ANTHROPIC_MODEL`: é um parágrafo por visita à tela, a qualidade do texto importa e
o custo é irrelevante nesse volume.

E o modelo é **fixado, não herdado** da sessão de quem instalou o CLI: herdar faria
o custo e o comportamento do chat mudarem quando a pessoa trocasse de modelo no
terminal por outro motivo. O chat é um produto, não uma sessão.

### O que eu supus errado sobre o motor CLI, e medi

**Reaproveitar a sessão não barateia.** A hipótese era que `--resume` faria o
contexto virar `cache_read` e o custo cair. Medido: primeira mensagem $0.2475,
retomada **$0.3261**. Subiu.

O custo é **por volta de ferramenta** — cada volta relê os ~32k tokens de contexto
do próprio CLI (system prompt, definições de tool, `CLAUDE.md` do diretório). Cinco
voltas custam cinco leituras.

O que a sessão dá, e é o que importa: **o fio da conversa**. Retomando com
`--resume`, o CLI já tem o histórico e o servidor não reenvia nada.

**O que barateia é cortar voltas.** Dar o esquema do banco no prompt em vez de
deixá-lo ler `habits://schema`: $0.2475/12.2s → **$0.1642/9.6s**. Um terço mais
barato. É por isso que o perfil `assistente` não registra os recursos de
descoberta — lê-los custaria a volta que o prompt evita.

**`--allowedTools` NÃO restringe.** Com `--allowedTools "mcp__habits__query"`, o
modelo chamou `request` e a chamada chegou ao servidor. Só `--disallowedTools`
bloqueia, e depender dela faria tool nova nascer chamável.

Por isso a defesa é topológica: `/mcp/assistente` **não tem** tool de escrita, só
`consultar` e `propor`. As duas flags vão junto como camadas, e nenhuma delas é a
garantia.

**O ambiente reduzido quebrou a autenticação.** O subprocesso roda com `env`
mínimo por segurança — não precisa do `DATABASE_URL` nem do `JWT_SECRET`. Com
`HOME`+`PATH`+`TERM` o CLI respondia `Not logged in · Please run /login`: a
credencial vive no keychain do macOS, e o keychain resolve o usuário por **`USER`**.
Bissecionado — `USER` sozinha resolve; `XPC_SERVICE_NAME`, `LOGNAME` e `SHELL` não
são necessárias.

O sintoma não menciona ambiente nenhum. Parece que a pessoa não fez login.

### Verificado à mão, ponta a ponta

Os testes de INV-38 provam o que não depende do modelo: a superfície sem escrita, o
`propor` que grava e não executa, a conferência de dono, e o arquivo de
configuração apagado. **Não** invocam o CLI — cada invocação custa da assinatura de
quem roda a suíte e leva de 11 a 28 segundos, e suíte abandonada é pior que suíte
incompleta.

O fluxo completo foi verificado à mão, com a API rodando no host:

1. *"Quantos hábitos ativos eu tenho e qual tem a melhor aderência?"* → 4 hábitos,
   Academia 85% (11 de 13), com os outros três listados. 28s, $0.20.
2. *"Tira a segunda-feira do Meditar 10min"* → **"Não alterei nada — deixei a
   sugestão para você aprovar"**, mais um cartão. O banco continuava `{1,2,3,4,5}`.
3. Aprovação → `{2,3,4,5}`, e a revisão gravada com `changedVia: assistant`.
4. Retomada → *"Você aprovou: o Meditar 10min agora está agendado de terça a
   sexta."*

## Sem motor configurado

O chat responde recusando, com o motivo legível, e o resto do app fica idêntico.

Isso é diferente do resumo de aderência, que tem alternativa determinística.
Conversar **é** a função — não há template que a substitua, e fingir uma resposta
seria pior que recusar. `GET /assistant/status` devolve `disponivel: false` com a
razão, e a interface mostra as instruções em vez de um chat quebrado.

## As rotas do assistente estão NEGADAS na allowlist

Todas as sete. O motivo é recursão: se `agir` pudesse chamar `POST
/assistant/messages`, uma conversa abriria outra, que proporia ações, que abririam
outra. Custo sem teto que nenhum dos quatro limites pega, porque cada nível parece
uma conversa legítima.

Ler o histórico continua possível por `consultar` — as quatro tabelas do assistente
são expostas à primitiva de leitura, com RLS pelo dono.

## As medições são TODAS do motor CLI, e isso importa

Custo, latência, a escolha do Sonnet, as onze voltas do Haiku — tudo medido no
motor que roda sobre `claude -p`, e esse é o motor que **não vai para produção**.

Em produção roda o SDK, que tem contexto diferente (não relê ~32k tokens por
volta), custo diferente e caminho de código diferente. **O teto diário em dólares
foi calibrado no motor errado**, e nenhuma medição do SDK existe porque não há
chave configurada nesta máquina.

Fica declarado como o que é: o chat que vai para produção é o **menos medido** dos
dois. A primeira coisa a fazer quando houver uma chave é medir uma pergunta pelo
SDK e pôr os dois números lado a lado.

E o que muda é mais útil que "falta medir": **a estrutura de custo é diferente em
espécie, não em escala.** O CLI relê ~32k tokens de contexto por volta de
ferramenta; o SDK reenvia o histórico da conversa, que começa pequeno e cresce. Um
tem custo quase constante por volta e o outro tem custo crescente por mensagem.

A consequência: o teto em dólares calibrado no CLI pode estar ordens de grandeza
folgado **ou** apertado no SDK, e **a direção não é previsível** sem medir. Não é um
fator de correção — é outra curva.

## A superfície nativa do subprocesso é vazia (INV-39)

`--allowedTools` governa **o que passa sem pedir aprovação**, não o que existe. Eu
medi que ele não impedia o modelo de chamar `request` e concluí "a flag não
restringe" — a medição estava certa, a conclusão errada, e por causa dela eu parei
de procurar a flag que restringe.

É `--tools`, e ela opera sobre o conjunto **embutido**. Sem ela o subprocesso tinha
`Read`, `Write`, `Edit`, `Bash`, `WebFetch`, `Glob`, `Grep` e `Task`, rodando com o
`HOME` de quem instalou o CLI — onde vivem `~/.ssh`, `~/.aws` e a credencial do
próprio CLI.

**Verificado com um arquivo inofensivo**: sem `--tools`, o subprocesso leu
`/tmp/prova-tools/alvo.txt` e devolveu o conteúdo pela resposta do chat. `Read` é a
única tool de que um atacante precisaria — não é preciso escrever nem executar nada
para exfiltrar credencial. Com `--tools ""` a mesma mensagem recebe *"não tenho
como fazer isso: as únicas ferramentas desta sessão são as do sistema de hábitos"*.

E a lição maior é sobre o perímetro: as invariantes 25 a 38 governam o que o
**servidor** aceita. O `spawn` introduziu um segundo executor, com os privilégios
do usuário do sistema operacional, e nenhuma delas o governava. A fronteira do
sistema deixou de coincidir com a API no commit em que o motor CLI entrou, e o mapa
de invariantes não acompanhou — nenhuma das cinco regras da safra faz a pergunta
"onde está a fronteira agora?".

## Retenção: só `ai_calls` (INV-40)

Eu havia declarado três tabelas sem política de descarte como se fossem o mesmo
problema repetido. Não são:

- `habit_revisions` e `conversation_messages` guardam **conteúdo** que a pessoa pode
  querer daqui a um ano, e descartar por idade apaga exatamente o que se quer
  recuperar de um erro antigo.
- `ai_calls` é o inverso em três eixos: o valor **decai**, o volume cresce com
  **uso** e não com edição, e nada nela é recuperável — é telemetria.

`npm run reter:telemetria` agrega o mês em `ai_usage_monthly`, **confere** que o
agregado bate com o que vai ser apagado, e só então apaga — mesma ordem do purge, e
pelo mesmo motivo. Sem `--confirmar` ele só mostra.

O agregado existe porque as duas perguntas têm horizontes diferentes: "quanto
gastei ontem?" precisa da linha individual, "meu gasto está subindo ao longo dos
meses?" precisa do agregado. Descartar sem agregar responderia a primeira e
perderia a segunda — que é a que justifica guardar custo.

## Duas decisões que são do Matheus, não minhas

**Quem pode registrar.** `POST /auth/register` é aberto, e toda chamada do chat
consome a assinatura pessoal dele. Hoje isso é local e inofensivo; no dia em que a
API for exposta, é a primeira coisa a fechar.

**O escopo do teto está POR USUÁRIO** — `orcamentoDoDia(userId)` filtra por
identidade. A consequência: N usuários multiplicam o gasto na conta dele. A
alternativa (teto global) trocaria isso por um usuário conseguir esgotar o dia de
todos. Nenhuma das duas é errada, e a escolha atual é a que está no código.

## O que ainda não existe

- **Streaming token a token.** O SSE emite eventos por bloco (o texto sai inteiro
  quando a volta termina), não caractere a caractere. A API suporta stream de
  verdade; ligá-lo exige tratar `content_block_delta` e é trabalho seguinte.
- **Custo em dinheiro.** `ai_calls` guarda tokens, não reais. Converter exige tabela
  de preço por modelo, que muda — e preço desatualizado escrito no banco é pior que
  ausente.
- **Editar mensagem enviada, ou ramificar a conversa.**
- **Teste de que o prompt produz boas decisões.** Os 18 casos de INV-34/35/36 provam
  as fronteiras com um cliente dublado — que a escrita para, que a RLS isola, que o
  teto recusa. Nenhum prova que o assistente é útil, e isso não é verificável por
  teste automático.
