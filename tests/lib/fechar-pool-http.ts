/**
 * Quantos recursos estão vivos agora, por tipo.
 *
 * Existe porque foi ele que decidiu a causa do flake `read ECONNRESET` sem
 * depender de reproduzi-lo: **2 `TCPSocketWrap` sobreviviam ao `servidor.close()`
 * em toda execução** — o pool keep-alive do `fetch` apontando para uma porta
 * efêmera morta. Determinístico, ao contrário da colisão de porta que produz a
 * falha.
 *
 * `--detectOpenHandles` não pega isso: ele relata o que está aberto quando a
 * suíte TERMINA, e o undici gerencia os sockets em pool interno que o Jest não
 * atribui a teste nenhum.
 *
 * ## O que esteve aqui e foi removido
 *
 * Um `fecharPoolHttp()` que buscava o dispatcher em
 * `globalThis[Symbol.for('undici.globalDispatcher.1')]` e chamava `.close()`.
 * Dentro do Jest o Symbol é `undefined` — o ambiente tem `globalThis` próprio —
 * então o helper era **no-op silencioso**, indistinguível do correto.
 *
 * Quem pegou foi o caso adversário que exigia os sockets DIMINUÍREM. Sem ele a
 * correção pareceria pronta, e o flake continuaria com a explicação errada
 * escrita ao lado. A correção que ficou é `tests/lib/porta-fixa.ts`.
 */
export function recursosAtivos(): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const recurso of process.getActiveResourcesInfo()) {
    contagem[recurso] = (contagem[recurso] ?? 0) + 1;
  }
  return contagem;
}
