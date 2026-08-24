/**
 * A porta do servidor que os testes levantam para a primitiva `request` alcançar.
 *
 * ## Por que NÃO é `listen(0)`
 *
 * `fetch` no Node é undici, e o `globalDispatcher` mantém sockets keep-alive por
 * origem no escopo do processo. Um `fetch` da primitiva contra um servidor em
 * porta **efêmera** deixa esse socket no pool, e `servidor.close()` **não** o
 * fecha — ele fica apontando para uma porta que já não escuta.
 *
 * Com `--runInBand` a suíte inteira roda num processo, e arquivos posteriores usam
 * supertest, que abre servidor em porta efêmera a cada requisição. O SO **recicla**
 * portas efêmeras: quando uma cai numa que o undici ainda tem em pool, o socket
 * morto e o listener novo se cruzam, e quem espera resposta recebe RST —
 * `read ECONNRESET`, num teste sem relação alguma com a causa.
 *
 * Medido com `process.getActiveResourcesInfo()`: **2 `TCPSocketWrap` sobrevivem ao
 * `servidor.close()`, em toda execução** — as duas pontas da mesma conexão, porque
 * `server.close()` para de aceitar e não fecha keep-alive já estabelecido.
 * Determinístico, ao contrário do flake.
 *
 * ## O que esta porta NÃO prova
 *
 * Que a reciclagem de porta causou o flake originalmente observado. Ela não
 * causou, provavelmente: o kernel roteia TCP por **4-tuple**, não por porta. Um
 * RST que o cliente obsoleto produza chega no servidor obsoleto — o mesmo par de
 * sockets —, e não no listener novo que o supertest abriu na mesma porta. A vítima
 * observada era um cliente de supertest, com socket e 4-tuple próprios.
 *
 * Então isto fecha uma CLASSE compatível com o sintoma, e não a causa. Vale ter
 * mesmo assim: a colisão deixa de ser possível em vez de rara, e o custo é um
 * número documentado.
 *
 * E sobre frequência: o flake foi visto **duas vezes, uma delas sem o nome do
 * teste** — o `grep` do turno o descartou. O que liga as duas ocorrências é a
 * contagem `1 failed, 115 passed`, e contagem não identifica: qualquer falha
 * isolada em 116 testes produz aquela linha. Podem ter sido duas coisas
 * diferentes, uma vez cada. Nenhuma taxa é sustentável a partir disso, e a que eu
 * havia escrito aqui — "~1 em 40" — saiu por isso.
 *
 * ## Por que não fechar o pool do undici, que seria o conserto direto
 *
 * Porque não funciona dentro do Jest, e isso foi MEDIDO. O dispatcher vive em
 * `globalThis[Symbol.for('undici.globalDispatcher.1')]`, e o ambiente do Jest tem
 * `globalThis` próprio: de dentro de um teste o Symbol é `undefined` mesmo depois
 * de um `fetch` que comprovadamente criou o dispatcher. Um helper que tentasse
 * fechá-lo por esse caminho seria um no-op silencioso — e era, até um caso
 * adversário exigir que os sockets diminuíssem e reprovar.
 *
 * ## O que esta porta resolve, e por que este número
 *
 * Fora da faixa efêmera, o SO **nunca** a atribui a um servidor de supertest.
 * O socket obsoleto do pool continua existindo, e deixa de poder colidir — é
 * proteção topológica, do mesmo tipo que "o delete físico não é rota".
 *
 * O número está abaixo das duas faixas que importam:
 *
 * - macOS: `net.inet.ip.portrange.first` = **49152**
 * - Linux (o do CI): `ip_local_port_range` = **32768**–60999
 *
 * `24333` está abaixo de 32768, então vale nos dois. Não é aleatório e não deve
 * ser trocado por um número maior sem conferir as duas faixas.
 */
/**
 * Uma porta POR ARQUIVO, e a razão é a correção anterior ter criado um problema.
 *
 * A primeira versão era uma constante só, e três arquivos de integração passaram a
 * usá-la. Com `--runInBand` isso vira fecha-e-reabre no MESMO endereço dentro do
 * mesmo processo — exatamente o cenário que eu havia medido produzindo
 * `read ECONNRESET` de forma determinística, e que o retry do gateway só cobre em
 * `GET`. O supertest não passa pelo gateway.
 *
 * O flake voltou por isso, e voltou COM NOME: `.verify.log` guardou
 * `INV-27: adversário — não há JOIN que alcance check-in de outra pessoa · read
 * ECONNRESET`. Foi a regra do `tee` pagando o próprio custo.
 *
 * Portas distintas removem o reuso de origem: cada arquivo tem a sua, nenhuma é
 * reaberta, e o pool do undici nunca tem socket obsoleto para um endereço que
 * volte a existir.
 *
 * ## Os números, e por que não são maiores
 *
 * Todas abaixo de **32768**, que é o piso do `ip_local_port_range` do Linux do CI
 * (o macOS começa em 49152). Fora da faixa efêmera, o SO nunca as atribui a um
 * servidor de supertest.
 */
const PORTAS: Record<string, number> = {
  'primitivas-mcp': 24333,
  assistente: 24334,
  'motor-cli': 24335,
};

/**
 * A porta deste arquivo de teste.
 *
 * Recebe o nome em vez de derivar de `__filename` porque derivar amarraria o mapa
 * ao caminho do arquivo: renomear o teste mudaria a chave em silêncio e cairia no
 * default, reintroduzindo o compartilhamento. Nome explícito falha alto.
 */
export function portaFixaPara(arquivo: keyof typeof PORTAS | string): number {
  const porta = PORTAS[arquivo];
  if (porta === undefined) {
    throw new Error(
      `Sem porta fixa para "${arquivo}". Acrescente uma em tests/lib/porta-fixa.ts, ` +
        'abaixo de 32768 e diferente das outras — compartilhar porta entre arquivos ' +
        'reabre o flake de ECONNRESET.'
    );
  }
  return porta;
}

/** Todas, para o teste que confere que são distintas e fora da faixa. */
export const TODAS_AS_PORTAS = PORTAS;

/** Faixas efêmeras conhecidas. O teste usa isto para AFIRMAR que a porta está fora. */
export const MENOR_PORTA_EFEMERA_CONHECIDA = 32768;

export function erroDePortaOcupada(porta: number): string {
  return [
    `A porta ${porta} está ocupada.`,
    'Ela é fixa de propósito — ver tests/lib/porta-fixa.ts. Feche o que a estiver',
    'usando; NÃO troque por `listen(0)`, que reabre o flake de ECONNRESET.',
  ].join('\n');
}
