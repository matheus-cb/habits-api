# As lições desta safra, e os defeitos que as produziram

O `AGENTS.md` carrega as regras. Este arquivo carrega **por que** cada uma existe —
com o defeito concreto que a produziu, porque regra sem caso se lê como preferência
de estilo e é a primeira a ser ignorada.

## O padrão que se repetiu treze vezes

*A verificação existe e olha para a metade errada.* Nunca foi falta de teste: era
teste que confirmava o pressuposto de quem o escreveu.

- **O `.gitignore` escondia as migrações.** `prisma/migrations/**/migration.sql`
  estava ignorado; `migrate deploy` respondia "No migration found" e saía com
  código 0. Um clone limpo subia sem nenhuma tabela.
- **`tsup` não checa tipo.** `npm run build` passava com 12 erros de tipo, entre
  eles uma chamada com 2 de 3 argumentos.
- **`/health` respondia 200 com zero tabelas.**
- **O teste de HKDF não testava HKDF.** A chave era constante de módulo, então duas
  instâncias sempre a compartilhavam — o teste passava com `randomBytes`.
- **Os dublês de `fetch` copiavam a expectativa do cliente**, não a resposta da API.
  27 testes verdes e `/auth/me` lido em `data.user`; fechar a aba deslogava.
- **`createdVia` era decorativa.** Coluna, tipo e comentário certos; nenhum chamador
  passava `assistant`. Toda escrita era registrada como da pessoa.
- **`swaggerDocument` tem `paths: {}`** e era servido em `/api-docs` desde sempre.
- **`AppError` fazia `setPrototypeOf(this, AppError.prototype)`** na base, apagando a
  identidade de toda subclasse. Nada quebrava: o único `instanceof` do projeto era
  contra a classe base, exatamente o caso que a linha errada fazia funcionar.
- **O purge destruía o histórico de edição** por cascade, sem exportá-lo e sem
  contá-lo na tela que precede o `--confirmar`. A mesma omissão aparecia três vezes
  no mesmo arquivo, cada uma com sua lista.
- **`pg_read_all_data`** dava à role somente-leitura acesso a toda tabela futura.
- **Três variáveis foram para o `.env` e não para o `docker-compose.yml`.** Na
  imagem o Zod caía nos defaults, e quem apertasse o teto de custo do assistente
  veria o número novo no arquivo e o comportamento antigo rodando — divergência
  silenciosa entre o que se configura e o que executa. O gate de INV-37 achou
  outras duas que faltavam desde antes: `CORS_ORIGIN` e `AI_TIMEOUT_MS`.
- **`GRANT CONNECT ON DATABASE habits`** com o nome literal numa migração. O
  pressuposto exato não era "estamos conectados a `habits`" — era **"existe um
  banco chamado `habits` neste servidor"**, e `GRANT ... ON DATABASE` não exige
  conexão com o alvo. Por isso a Camada 2 passava contra `habits_test`: no
  Postgres local os dois bancos coexistem. No serviço do CI existe só o de teste.

## Regra 1 — verificação nova tem caso vizinho

Depois de escrever um gate, construa o caso que ele **deveria** pegar. O caso que o
motivou já passa por construção.

Três iterações da extração de seções do `check-agent-docs.sh` foram pegas assim. E
o `app.router` do Express 4, que **lança** por compatibilidade com o 3.x: o
`app.router ?? app._router` nunca chegava ao segundo operando, e o sintoma era "o
enumerador não acha rota" — que se lê como "não há rota órfã".

**É a única das cinco que não depende de atenção no instante de escrever**, porque é
um passo externo ao ato: não pede comparar intenção com efeito, pede construir um
objeto novo e olhar.

## Regra 2 — ancore em sumário, nunca em substring de saída livre

Duas instâncias:

- `isError` satisfeito por `Tool request not found` — uma asserção sobre allowlist
  passando verde por a ferramenta não existir. Verificação que falha por ausência é
  pior que nenhuma: produz evidência positiva.
- `grep -q "failed"` casando com `Raw query failed` dos testes adversários. Um
  caçador de flake reportou **25 falhas em 25 execuções verdes**.

## Regra 3 — filtre a exibição, nunca a captura

Um flake ficou sem diagnóstico porque um `grep` descartou o nome do teste. É
categoria diferente das outras: nelas a evidência existia e a verificação olhava para
o lado errado; nesta ela **deixou de existir**. É a mais barata de fechar — `tee`
custa o mesmo.

## Regra 4 — calibre instrumento novo, e reproduza no ambiente que vale

Cinco defeitos foram instrumento certo em ambiente errado:

- `npm install` (permissivo) validando o que o CI roda com `npm ci` (estrito)
- container de 16 horas atrás testando código novo
- screenshot escalado (800x562 de uma viewport 1280x900) lido como 1:1 — fez um
  botão funcionando parecer quebrado, duas vezes
- `.verify.log` ausente porque o verify rodou em segundo plano com filtro
- **e uma na direção inversa:** um cenário de socket obsoleto passa em Node puro e
  falha deterministicamente sob Jest. O ambiente mais permissivo **esconde** o
  defeito, e parar nele dá medição correta com conclusão errada.

## Regra 5 — asserção sobre efeito, nunca sobre chamada

Um helper de teardown que buscava o dispatcher do undici era **no-op silencioso**
dentro do Jest — o Symbol não existe no `globalThis` do ambiente de teste.
`resolves.toBeUndefined()` teria passado para sempre. O que o pegou foi exigir que os
sockets **diminuíssem**.

Precisa dos dois lados para acontecer: conselho não medido, e quem implementa
conferindo a existência da chamada em vez do efeito dela.

## A categoria que nenhuma regra nomeia

Uma correção conteve, na primeira linha, a classe de defeito que ela existia para
fechar: `void promessa.finally(...)` devolve uma promessa que rejeita sem tratamento,
e no Node 22 isso derruba o processo. A defesa contra trabalho não aguardado criando
trabalho não aguardado.

Inalcançável pelo caso de origem por construção — em produção
`Promise.allSettled(...).then(() => undefined)` nunca rejeita. Nenhuma quantidade de
cuidado ao escrever pegaria, porque o caminho que falha não é o caminho que a função
serve. Só um caso que registra uma rejeição de propósito chega lá.

**Regra que precisa nomear cada categoria não escala; procedimento externo ao ato,
sim.** É por isso que a Regra 1 é a que mais importa.

## Conclusão errada encerra a busca — e por isso custa mais que medição errada

**Medição errada eu repito. Conclusão errada eu paro.**

Medi que `--allowedTools "mcp__habits__query"` não impedia o modelo de chamar uma
tool fora da lista, e concluí *"a flag não restringe"*. A medição estava certa e a
conclusão errada — `--allowedTools` governa o que passa **sem pedir aprovação**, não
o que existe.

E o custo não foi o erro: foi **eu parar de procurar**. Existe `--tools`, que
restringe o conjunto embutido, e eu não a procurei porque já tinha concluído que a
categoria "flag que restringe" não existia. Sem `--tools`, o subprocesso tinha
`Read`/`Write`/`Bash` com o `HOME` do usuário do sistema — a pior falha da safra.

Uma medição errada é **auto-corrigível**, porque você a repete. Uma conclusão errada
é **auto-selante**, porque ela remove o motivo de repetir.

O que a fecha: escrever a conclusão **e o que ela implica que não existe.** "A flag
não restringe" é conclusão; "portanto não há flag que restrinja" é a implicação, e é
ela que fecha a busca. Escritas lado a lado, a segunda pede verificação — porque é
afirmação de **ausência**, e afirmação de ausência é o formato que não se aceita sem
conferir.

## Onde está a fronteira agora? — e por que isso não é uma regra de julgamento

As invariantes que governavam o servidor não governavam o subprocesso, porque a
fronteira do sistema deixou de coincidir com a API no commit em que o `spawn`
entrou. Nenhuma das regras acima faz essa pergunta: elas cobrem se a verificação
olha certo, não se o perímetro mudou de lugar.

"Pergunte onde está a fronteira" pediria julgamento no instante, e é a categoria que
esta safra mostrou que falha. Mas a fronteira **não se move por vontade** — ela se
move quando entra um novo principal de execução, e isso tem assinatura sintática.
Grepável.

INV-41 é a quarta aplicação do mesmo procedimento — depois de rotas (INV-26),
tabelas (INV-29) e tabelas em cascade (INV-32): **toda ocorrência que cria executor
está classificada, ou reprova.**

E o campo que faz o trabalho é `credencial`. Não `superficie`, não `governadaPor`:
escrever *"o `HOME` de quem instalou o CLI"* ao lado de *"apenas tools MCP"* não
sobrevive à leitura sem alguém notar a distância entre as duas colunas.

O meu erro não foi falta de cuidado. Quando criei a role somente-leitura eu estava
pensando **em segurança**, e respondi com grant explícito, RLS, política e duas
invariantes. Quando criei o subprocesso eu estava pensando **em custo e
autenticação**. O perímetro mudou nas duas vezes; eu só o vi na vez em que o assunto
do dia já era perímetro.

## Quando a correção cria o problema seguinte

A porta fixa fechou a colisão por reciclagem e **criou** o reuso de origem: três
arquivos de integração passaram a ligar a mesma porta, e com `--runInBand` isso é
fecha-e-reabre no mesmo endereço dentro do mesmo processo — o cenário que eu já
havia medido produzindo `ECONNRESET`.

O retry do gateway só cobre `GET`, e o supertest não passa pelo gateway. O flake
voltou, num teste sem relação com a causa.

Duas coisas a tirar:

1. **Porta por arquivo**, não uma constante compartilhada, com um erro alto quando
   falta entrada. Default silencioso reintroduziria o compartilhamento.
2. **A regra do `tee` se pagou na primeira reincidência.** O `.verify.log` guardou
   o nome do teste e o erro — a informação que faltou na primeira ocorrência e que
   custou quatro rodadas de hipótese.

## Enumerar os casos que se tem em mão, em vez de descrever a classe

O retry do gateway classificava falha de conexão por uma **lista** de códigos:
`ECONNRESET`, `ECONNREFUSED`, `EPIPE` — os que eu havia observado no macOS. O CI
reprovou no Linux com `SocketError: other side closed`, do undici, código
`UND_ERR_SOCKET`. O retry não disparou, e o teste que afirma a recuperação falhou
num ambiente depois de passar no outro.

A correção **inverte a pergunta**. `fetch` só lança em falha de transporte —
resposta HTTP de erro volta como `Response`, não como exceção. Então a pergunta não
é "qual código?" e sim "há motivo para NÃO repetir?", e a resposta é curta:
cancelamento e timeout.

Invertida assim, código novo do undici passa a ser coberto por padrão — a direção
segura para um retry restrito a `GET`. É a mesma forma de INV-26 e INV-29: o que se
enumera é a exceção, e o default é o comportamento certo.

## Sobre depuração de flake

Três coisas fizeram a única depuração de flake desta safra funcionar, e nenhuma foi
hipótese: **preservar o log, mudar o ambiente, medir o efeito.**

E uma observação generalizável: **hipótese errada que muda o ambiente de execução
vale mais que hipótese certa que não muda nada.** Duas hipóteses erradas produziram
os dois achados — uma pediu rodar a suíte em outro fuso (e produziu a única
reprodução em 40 execuções), a outra pediu fechar o pool do undici (e produziu o
cenário que reproduz a classe sob demanda).
