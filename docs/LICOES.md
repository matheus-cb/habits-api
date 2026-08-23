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

## Sobre depuração de flake

Três coisas fizeram a única depuração de flake desta safra funcionar, e nenhuma foi
hipótese: **preservar o log, mudar o ambiente, medir o efeito.**

E uma observação generalizável: **hipótese errada que muda o ambiente de execução
vale mais que hipótese certa que não muda nada.** Duas hipóteses erradas produziram
os dois achados — uma pediu rodar a suíte em outro fuso (e produziu a única
reprodução em 40 execuções), a outra pediu fechar o pool do undici (e produziu o
cenário que reproduz a classe sob demanda).
