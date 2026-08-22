# Checklist de aceite

Estado real, medido. Item desmarcado é lacuna conhecida, não esquecimento.

## Ambiente limpo

- [x] `.env.example` pode ser copiado sem conter segredo real.
- [x] `docker compose config --quiet` passa.
- [x] `docker compose up --build --wait` deixa a stack saudável — a imagem sobe,
      as migrações são aplicadas e o healthcheck fica verde.
- [x] `npm run docker:up && npm run prisma:migrate` deixa o banco pronto.
- [x] A API sobe e funciona **sem** `ANTHROPIC_API_KEY`.
- [x] Nenhuma variável de IA é obrigatória no schema Zod do ambiente.

## Convenção de contexto de agente

- [x] `AGENTS.md` é canônico; `CLAUDE.md` só o importa.
- [x] `scripts/check-agent-docs.sh` verifica a convenção e passa.
- [x] Toda invariante de INV-01 a INV-19 tem teste que a cita pelo número —
      verificado pelo próprio gate, não pela leitura de quem escreveu.
- [x] Numeração `INV-nn` compartilhada com `habits-dashboard` e `habits-mobile`.

## Reprodutibilidade

- [x] **As migrações estão versionadas.** `.gitignore` excluía
      `prisma/migrations/**/migration.sql`: um clone tinha o lock e nenhuma
      migração, `migrate deploy` respondia "No migration found" e **saía com
      sucesso**, e o banco ficava sem tabela. Foi o que derrubou a Camada 2 e o
      smoke na primeira execução do CI.
- [x] `/health` consulta o banco, com `findFirst` (tempo constante, não
      `COUNT(*)`), timeout de 2s e envelope de **erro** no 503. Antes respondia 200
      com o processo vivo e zero tabelas.
- [x] **Camada 3.5** (`npm run verify:repro`): `git archive HEAD` → build →
      migrate → smoke. Verificado que pega o defeito das migrações fora do índice.
- [x] Checagem 8 do gate compara migrações no disco com as do índice.

## Segurança da suíte

- [x] A Camada 2 roda em banco separado (`habits_test`, de `.env.test`).
- [x] `tests/setup.ts` **recusa** apagar tabelas se o nome do banco não terminar
      em `_test`, e se `NODE_ENV` não for `test`.
- [x] A trava tem teste próprio na Camada 1, incluindo o caso
      `habits_test_backup`, que passaria num `includes('_test')`.
- [x] `.env.test` é carregado com `override: true`, então um `DATABASE_URL`
      exportado no shell não redireciona a suíte.

## Domínio

- [x] Um check-in por hábito por dia, garantido pela constraint do banco.
- [x] Corrida perdida na constraint responde 409, não 500.
- [x] O dia do check-in é resolvido em UTC, independente do fuso da máquina.
- [x] Aderência medida contra dias agendados, não contra dias corridos.
- [x] A janela de aderência nunca começa antes da criação do hábito.
- [x] Check-in em dia não agendado é aceito e não altera a taxa.
- [x] Sequência conta só dias agendados; dia não agendado é vão, não falha.
- [x] `scheduledDays` recusa dia fora de 0..6, repetido, ou mais de sete.
- [x] Hábito e check-in só acessíveis pelo dono; caso contrário 403.
- [ ] **Fuso por usuário.** O dia é UTC para todos. Para quem está em UTC−3, o
      "dia" do hábito vai de 21h a 21h. Declarado em `docs/DECISOES.md`.

## Camada de IA

- [x] Nenhum número nasce do modelo: `AdherenceService` calcula, o modelo redige.
- [x] Numeral fora do relatório reprova a redação (`narration.guard.ts`).
- [x] O redator determinístico passa pelo próprio guarda — testado.
- [x] Sem chave, o endpoint responde igual, com `source: "deterministic"`.
- [x] `fallbackReason` é um de cinco códigos fechados, nunca a mensagem do provedor.
- [x] A resposta não carrega chave, prompt integral nem raciocínio do modelo.
- [x] Tools MCP são somente leitura, por tipo e por lista fechada.
- [x] Nenhuma tool MCP aceita `userId`: o escopo vem do JWT, por closure.
- [x] Reagendamento só é aplicado pelo `confirm`, com assinatura HMAC válida.
- [x] Proposta expira em 10 minutos.
- [x] O `confirm` revalida dono, existência do hábito e formato dos dias.
- [x] Token de uma pessoa não é aplicável por outra, mesmo assinado.
- [ ] **Auditoria de execução de IA.** Não há tabela de chamadas, custo ou
      tokens. O NotaFlow tem (`AiDraftRun`); aqui não.
- [ ] **Limite de taxa.** Deixou de ser paridade com a régua e passou a ser
      **pré-requisito de duas correções já aplicadas**: o `/health` agora consulta
      o banco (endpoint público, sem limite, consumindo conexão do pool) e o
      `getProposals` paralelizou (até 5 chamadas ao provedor por requisição).
      As duas trocaram problema observável por pressão de concorrência, e a
      defesa contra pressão de concorrência é a peça que não existe.
- [ ] **Chave de assinatura compartilhada.** É sorteada por processo, então a API
      não roda em várias instâncias sem uma chave em comum.
- [ ] **Números por extenso.** O guarda lê dígitos; "oito de doze" escapa dele. O
      prompt exige algarismos, e essa é a única defesa nesse caso.

## Testes e CI

- [x] Camada 1 roda sem serviço externo: 161 casos.
- [x] Camada 2 roda contra PostgreSQL real.
- [x] `verify.sh` sai com **código 3** quando a Camada 2 não pôde rodar.
- [x] `tsc --noEmit` é passo separado — `tsup` não checa tipo.
- [x] `npm run lint` com `--max-warnings=0`.
- [x] Cada invariante tem também um caso **adversário**, que tenta violá-la.
- [x] Camada 3 sobe a stack (`docker compose --wait`) e bate nela por HTTP.
- [x] CI: `agent-docs`, `camada-1`, `camada-2`, `smoke` e `build`.
- [x] O smoke tem **uma** cópia (`scripts/smoke.sh`), chamada pelo CI e rodável
      localmente — em vez de setenta linhas de `curl` embutidas no YAML.
- [x] Falha no smoke despeja os logs dos containers, e a stack é derrubada sempre.
- [ ] **Sem deploy.** O gate é só de qualidade.
- [ ] **Sem teste de controller isolado.** Os controllers montam as próprias
      dependências no construtor, então não há como injetar dublê; eles são
      exercitados só pela Camada 2, via HTTP. `InsightsController` é a exceção.

## Documentação

- [x] `AGENTS.md` com as invariantes e o arquivo onde cada uma vive.
- [x] `docs/IA.md` com a fronteira, seus limites e o que a camada **não** faz.
- [x] `docs/DECISOES.md` com o trade-off de cada decisão.
- [x] Derivas corrigidas: README anunciava gamificação inexistente, `API.md`
      documentava 422 onde o código responde 400, `ARQUITETURA.md` mostrava um
      factory pattern que nunca existiu.
- [ ] **Swagger dos endpoints de insight** documentado só por JSDoc nas rotas;
      não há exemplo de resposta.
