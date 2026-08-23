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
