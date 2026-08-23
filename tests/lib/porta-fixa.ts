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
 * Isso explica cada fato do flake que perseguimos: precisa do arquivo do MCP antes
 * (o único que faz `fetch` real para porta efêmera), precisa da suíte inteira (a
 * reciclagem exige volume — a ausência de reprodução no par isolado é PREVISTA
 * pelo mecanismo, não contra ele), e a ~1 em 40 é a probabilidade da colisão.
 *
 * Medido com `process.getActiveResourcesInfo()`: **2 `TCPSocketWrap` sobreviviam ao
 * `servidor.close()`, em toda execução.** Determinístico, ao contrário do flake.
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
export const PORTA_FIXA_DE_TESTE = 24333;

/** Faixas efêmeras conhecidas. O teste usa isto para AFIRMAR que a porta está fora. */
export const MENOR_PORTA_EFEMERA_CONHECIDA = 32768;

export function erroDePortaOcupada(porta: number): string {
  return [
    `A porta ${porta} está ocupada.`,
    'Ela é fixa de propósito — ver tests/lib/porta-fixa.ts. Feche o que a estiver',
    'usando; NÃO troque por `listen(0)`, que reabre o flake de ECONNRESET.',
  ].join('\n');
}
