# Camada de IA

> Fronteira em uma frase: **a IA sugere, o código valida, a decisão é do usuário.**
> Nada que altere estado passa pelo modelo.

As regras desta camada são invariantes numeradas em [AGENTS.md](../AGENTS.md),
INV-13 a INV-19. Este documento explica **por que** cada uma existe e onde ela
falha. Para o que a camada faz, ver os três endpoints abaixo.

## As três peças

| Peça | Onde | O que a IA faz | O que a IA **não** faz |
|---|---|---|---|
| Servidor MCP | `POST /mcp` | nada — é um servidor, não um cliente | escrever: não existe tool de escrita |
| Resumo de aderência | `GET /api/v1/insights/adherence` | redige o texto | calcular qualquer número |
| Proposta de reagendamento | `GET`/`POST .../insights/reschedule-proposals` | redige a justificativa | escolher os dias, ou aplicá-los |

## Por que o MCP é para assistente externo

No NotaFlow o servidor MCP é do serviço de estoque e o cliente é o de
faturamento — dois processos. Aqui existe uma API só. Se ela fosse servidor e
cliente do próprio MCP, passaria a chamar a si mesma pelo protocolo, que é
exatamente a armadilha que o AGENTS.md daquele projeto registra.

Então o MCP daqui existe para um assistente **externo** (Claude Desktop, Claude
Code) ler hábitos e estatísticas. Cinco tools, todas de leitura:
`list_habits`, `get_habit`, `get_habit_stats`, `list_checkins`,
`get_adherence_report`.

Três camadas impedem escrita, e a ordem importa — da mais forte para a mais
fraca:

1. **O tipo.** As tools recebem `ReadOnlyHabitsGateway`, que não tem método de
   escrita. Não há o que chamar.
2. **A lista fechada.** `TOOLS_SOMENTE_LEITURA` é conferida por teste: uma tool
   nova não entra sem alguém decidir por isso.
3. **A anotação.** `readOnlyHint: true`, `destructiveHint: false`,
   `openWorldHint: false` — é como o cliente MCP decide se precisa confirmar.

A anotação declara a intenção; o tipo é o que a torna inalcançável. Se a defesa
fosse só "as tools registradas não escrevem", ela dependeria de quem escrevesse
a próxima tool lembrar disso.

O `userId` vem do JWT e fica **fechado por closure** no registro da tool.
Nenhuma tool aceita `userId` como argumento — se aceitasse, um assistente
poderia pedir os hábitos de outra pessoa. Servidor e transporte são criados por
requisição, sem sessão: não há estado de usuário guardado para vazar.

## Por que o modelo não calcula nada

`AdherenceService` produz um `AdherenceReport` por contagem sobre check-ins
gravados. O modelo recebe esse objeto **fechado** e devolve texto. O contrato do
`Narrator` é `Promise<string>` — não existe caminho por onde a redação devolva
número.

Isso resolve o modo de falha que mais importa aqui: um resumo bem escrito sobre
um número errado. E é por isso que o `completionRate` foi corrigido **antes** da
IA entrar: ele dividia por 30 fixo, então um hábito de três vezes por semana
cumprido à risca marcava ~43%. A IA teria redigido um texto correto sobre isso.

## O guarda numérico — INV-14

Um modelo "generoso" que escreva *"você cumpriu 9 dos 12"* quando o cálculo diz
8 de 12 produz texto impecável e número falso. Nenhuma revisão de estilo pega
isso, e **nenhuma instrução de prompt garante isso** — instrução é pedido, não
controle.

Então `narration.guard.ts` extrai os numerais do texto e reprova o que não
existir no relatório. Arredondamento é tolerado (66,67 → 67 é apresentação);
número novo não é. Reprovada, a redação é descartada e o determinístico assume,
com `fallbackReason: "AI_NUMBERS_UNVERIFIED"` na resposta.

Duas decisões de calibragem que valem registro:

- **As partes das datas não entram no conjunto permitido.** Admiti-las liberava
  todo inteiro de 1 a 31 mais o ano — a faixa exata em que um número fabricado se
  esconde, porque "9" poderia ser um dia do mês. O preço é que a redação não pode
  escrever data em algarismos, e o prompt pede o período em palavras.
- **Contagens derivadas entram.** "Duas sequências em risco" é fato verificável
  do objeto, obtido por contagem. O teste
  `INV-14: o redator determinístico passa pelo próprio guarda` é o que mantém
  essa lista honesta: se um campo novo entrar no relatório e não for admitido, o
  próprio piso da camada deixa de passar e o teste cai.

**Limite conhecido:** o guarda lê dígitos. Um modelo que escreva "oito de doze"
por extenso escapa dele. Por isso o prompt exige algarismos para toda
quantidade — a exigência é parte da defesa, não estilo. Não é uma defesa
completa, e está declarada como incompleta.

## Sem chave, tudo continua funcionando — INV-15

`ANTHROPIC_API_KEY` é opcional no schema de ambiente. Sem ela, a API sobe igual e
os endpoints respondem igual: `DeterministicNarrator` redige por template sobre
os mesmos números, e a resposta traz `narration.source: "deterministic"`.

Isso é **estrutural, não um `if`**: existem dois implementadores da mesma
interface e `createInsightsService()` escolhe um na composição. Nenhum service
pergunta se há chave. Sem isso, a fronteira se dissolveria em
`if (env.ANTHROPIC_API_KEY)` espalhados pelo código.

A suíte de integração roda **sem** chave de propósito. Se um teste passar a
exigir chave, ele quebra no CI — e é o que se quer que aconteça.

`fallbackReason` é sempre um de cinco códigos fechados: `AI_NOT_CONFIGURED`,
`AI_UNAVAILABLE`, `AI_REFUSED`, `AI_NUMBERS_UNVERIFIED`, `AI_EMPTY_RESPONSE`.
Nunca a mensagem do provedor — mensagem de erro de provedor é lugar comum de
vazamento de trecho de prompt (INV-16).

## Reagendamento: proposta assinada — INV-18 e INV-19

Único caminho por onde uma sugestão de IA altera estado, e ele tem quatro
travas:

1. **Os dias vêm do motor determinístico** (`reschedule.engine.ts`), nunca do
   modelo. O modelo redige a justificativa de uma decisão que não é dele.
2. **A proposta é assinada em HMAC** e vale 10 minutos. Confirmação apenas na
   interface seria contornável chamando o endpoint direto — e título de hábito é
   entrada livre do usuário, então essa possibilidade não é hipotética. A
   confirmação é controle de **servidor**.
3. **O `confirm` revalida tudo do zero**: dono, existência do hábito e formato
   dos dias. A proposta é sugestão, não autorização. Se o hábito foi apagado ou
   trocou de dono entre propor e confirmar, o confirm falha.
4. **O `userId` vai dentro do payload assinado** e é comparado com o do JWT. Sem
   isso, um token vazado seria aplicável por qualquer sessão.

Regras do motor, todas por contagem:

| Regra | Valor |
|---|---|
| Aderência acima da qual não há proposta | 80% |
| Fração de falhas para um dia sair | 60% |
| Ocorrências mínimas para o sinal contar | 2 |
| Check-ins espontâneos para um dia entrar | 2 |

Lista vazia é resultado normal e frequente. Propor mudança sem sinal é o modo de
falha mais provável desta funcionalidade — e o mais fácil de disfarçar com texto
convincente. A proposta também nunca fica vazia: conjunto vazio significa "todo
dia" no domínio (INV-07), o oposto de aliviar a rotina.

**Limitação real:** a chave de assinatura é sorteada por processo. Uma proposta
não sobrevive a reinício, o que é desejável para algo que vale minutos — mas
significa que a API não roda em várias instâncias sem uma chave compartilhada.

## Configuração

| Variável | Obrigatória | Default | Para que serve |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | não | — | ausente ⇒ redator determinístico |
| `ANTHROPIC_MODEL` | não | `claude-opus-5` | modelo da redação |
| `AI_MAX_OUTPUT_TOKENS` | não | `1024` | resumo é texto curto |
| `AI_TIMEOUT_MS` | não | `20000` | estourar cai no determinístico |

A chave fica **só no servidor**. Os clientes (dashboard e mobile) falam com a API
do Habits; nenhuma resposta carrega chave, prompt integral ou raciocínio do
modelo.

## O que esta camada não faz

Registrado para não parecer omissão:

- Não conversa. Não há assistente de chat, histórico nem sessão.
- Não aceita imagem nem áudio.
- Não usa tool a partir do modelo: a chamada de redação não declara `tools` nem
  `mcp_servers`.
- Não persiste nada sobre a execução da IA — não há tabela de auditoria de
  chamadas, custo ou tokens. O NotaFlow tem (`AiDraftRun`); aqui não.
- Não tem limite de taxa próprio nos endpoints de insight.

Os dois últimos são as lacunas mais evidentes se esta camada for para produção
com uso real.
