# Primitivas do MCP

## O que é diferente aqui

O NotaFlow expõe uma tool MCP por operação. O alcance do assistente é exatamente
o que alguém antecipou, e a barreira é o **tipo**: não existe método de escrita
para chamar.

Este projeto faz o contrário, por decisão explícita do Matheus: em vez de tool por
pergunta, **duas primitivas que o cliente compõe**.

- **`query`** — SQL somente leitura. Quem tem a pergunta escreve a pergunta.
- **`request`** — chamada à própria API, inclusive escrevendo.

O motivo é o uso: a ferramenta é de uso próprio, consumida pelo Claude Code, e a
maior parte do valor está nas perguntas que ninguém previu — "em que dia da semana
eu mais falho no hábito que criei em março?" não é uma tool, é uma consulta.

A troca é real e vale ser dita sem enfeite: **o guardião deixa de ser a ausência
de método**. Em troca, ele passa a ser permissão de banco, política de linha e
allowlist fechada — coisas que não dependem de eu ter lembrado.

## Onde a garantia mora, primitiva por primitiva

| | tool nomeada | primitiva |
|---|---|---|
| não escreve | o gateway não tem método de escrita (tipo) | o role não tem grant (Postgres) |
| não vê dado alheio | o `userId` fecha por closure | RLS compara com `app.usuario_atual` |
| validação de entrada | Zod na tool | Zod na rota, igual ao navegador |
| irreversibilidade | não existe escrita | soft delete + extensão que recusa `delete` |

Duas linhas ficam **mais fortes** e uma fica mais fraca.

Mais fortes porque `permission denied` do Postgres e política de linha não são
verificações que eu escrevi — são o banco recusando. Parsear a consulta para
descobrir se ela escreve perderia para comentário, CTE, `DO` e função; é a mesma
lição do guarda numérico de INV-14, onde verificação sobre texto só pega quem
inventa, não quem recombina.

Mais fraca porque a allowlist de `request` é lista conferida em tempo de execução,
não ausência de método. O que sustenta: ela é **literal e fechada**, e cada rota
que existe está classificada.

## Por que a allowlist é literal e a obrigação de classificar é derivada

Duas vezes nesta safra a lição foi "derive, não duplique" — e aqui eu escolhi
literal de propósito. O que decide não é a regra, é a **direção da divergência**:

- Derivar a permissão do OpenAPI faria **rota nova nascer permitida**. Um endpoint
  destrutivo acrescentado amanhã entraria no alcance do assistente por omissão.
- Uma lista literal divergindo produz "menos permitido do que existe" — a chamada
  é recusada, alguém acrescenta a rota. Falha benigna.

Numa lista de política de segurança o default seguro é negar. Então a permissão é
literal, e o que se deriva é a **obrigação de decidir**: o teste de INV-26 enumera
o stack do Express e exige que toda rota esteja em `ROTAS_PERMITIDAS` ou em
`ROTAS_NEGADAS`, com motivo. Rota nova quebra o teste até alguém classificá-la.

A decisão continua humana. O que deixa de ser opcional é tomá-la.

## Escrita livre, irreversibilidade não

O pedido foi "inserts e deletes lógicos, podendo recuperar alguns deles, e o
delete real fica a uma ação direta do usuário". Isso está implementado em quatro
camadas, e nenhuma delas é convencional:

1. **Índice único parcial.** `WHERE "deletedAt" IS NULL` — desfazer um check-in e
   remarcar no mesmo dia funciona. O índice total de antes colidia com uma linha
   que a pessoa não vê mais.
2. **Extensão do Prisma que recusa `delete` e `deleteMany`.** Não filtra: lança. O
   client da aplicação não tem delete físico, e o `deletedAt: null` é injetado em
   toda leitura em vez de nos doze lugares onde alguém lembrou de filtrar.
3. **`deleteBatchId`.** Apagar um hábito apaga os check-ins dele com um marcador
   de lote, e o restore devolve só o lote — não ressuscita o que já estava
   apagado antes.
4. **O delete físico não é rota.** É `npm run purge`, que exige o hábito já
   apagado logicamente, escreve o backup em `.parcial`, faz `fsync`, relê,
   confere as contagens, renomeia, e só então apaga. Proteção topológica: não há
   endpoint a permitir ou negar.

## A proveniência, e a assimetria que a torna honesta

`createdVia` marca se um registro nasceu da pessoa ou do assistente. A marca vem
de um cabeçalho que o gateway acrescenta em **toda** chamada, e o cliente MCP não
tem como removê-lo — ele nem monta a requisição HTTP.

- **Sub-registrar é impossível.** Escrita do assistente gravada como `user` não
  pode acontecer.
- **Sobre-registrar é possível.** Quem tem o token pode mandar o cabeçalho na mão.

A direção que importa para auditoria é a primeira, e está fechada. Fechar a
segunda exigiria um canal que não passa pelo HTTP — e aí a primitiva deixaria de
reusar o middleware de validação, que é o motivo de ela existir.

Vale registrar o que esta coluna era antes: ela existia no schema, no repositório
e nos dois services, com um comentário explicando que a origem "vem de quem chama
no servidor, nunca do corpo". O que não existia era alguém passando `assistant`.
Toda escrita, inclusive a do MCP, era gravada como `user` — uma coluna de
auditoria que não distinguia nada. É a mesma família de defeito que este
repositório vem catalogando: a verificação existe e olha para a metade errada.

## Descoberta: três recursos, todos derivados

- `habits://schema` — do `information_schema`, pela própria conexão
  somente-leitura. Coluna nova aparece sozinha.
- `habits://rotas` — a **mesma constante** que o gateway confere.
- `habits://contratos` — JSON Schema gerado dos schemas Zod que o servidor
  executa na validação.

Nenhum é escrito à mão, e o motivo está no repositório: o `swaggerDocument` tem
`paths: {}` e foi servido em `/api-docs` desde sempre como se descrevesse a API.
Contrato escrito à mão não avisa quando fica errado.

## O que ainda não existe

- **Limite de taxa.** Um cliente pode chamar `query` em laço. O
  `statement_timeout` de 5s do role limita cada consulta, não a frequência.
- **Log de execução da IA.** `createdVia` diz que o assistente escreveu; não diz
  o que ele consultou nem quando. As duas coisas passam a ser obrigatórias se
  houver superfície de chat no dashboard.
- **`paths` do OpenAPI.** Dívida declarada. O conserto é derivar da mesma fonte
  que `habits://contratos`.
