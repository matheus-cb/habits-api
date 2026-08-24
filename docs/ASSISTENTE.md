# O assistente conversacional do dashboard

## O que ele é

Um chat dentro do Habits. Você escreve em português, ele consulta os seus dados e
responde — e quando quer **alterar** algo, ele para e pede.

Não é o mesmo que o MCP. São duas superfícies para o mesmo motor:

| | MCP | Chat do dashboard |
|---|---|---|
| Cliente | Claude Code / Claude Desktop | o próprio dashboard |
| Quem paga | a assinatura de quem conversa | `ANTHROPIC_API_KEY` do servidor |
| Confirmação de escrita | o cliente MCP tem a dele | **ação pendente**, no banco |
| Precisa de chave? | não | **sim** |

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

## Dois motores, e a ordem é deliberada

| | Chave da API | Assinatura do Claude Code |
|---|---|---|
| Configuração | `ANTHROPIC_API_KEY` | `CLAUDE_CLI_PATH` |
| Custo por pergunta | ~$0.02 | **$0.17–0.20** (medido) |
| Tempo por pergunta | ~3s | **11–28s** (medido) |
| Roda no container | sim | **não** — o CLI não existe na imagem |
| Streaming | por bloco | resposta inteira no fim |

A chave ganha quando existe, e a ordem não é configurável: se há chave, use a
chave. Uma variável para inverter seria uma chance de rodar o caminho caro sem
querer.

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

## Sem chave

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
