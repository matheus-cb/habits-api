import { logger } from '@/utils/logger';

/**
 * Registro dos fechamentos que o handler de `res.on('close')` dispara sem
 * aguardar.
 *
 * ## Por que isto existe
 *
 * O endpoint MCP cria um `McpServer` e um transporte por requisição, e os fecha
 * quando a resposta termina. O handler de `close` é **síncrono** e a requisição já
 * acabou, então não há onde aguardar — em produção isso é correto e inconsequente:
 * o processo é longo e o fechamento completa em milissegundos.
 *
 * Em teste é diferente. Com `--runInBand` a suíte inteira roda num processo, e um
 * fechamento disparado no fim de um arquivo completa no meio do seguinte,
 * mexendo em conexão enquanto outro teste usa a rede. A assinatura disso é uma
 * falha isolada, num teste que não tem relação com a causa, irreprodutível.
 *
 * E o instrumento óbvio não vê: `--detectOpenHandles` relata o que está **aberto
 * quando a suíte termina**. Trabalho que dispara e completa no meio não está
 * aberto no fim, então uma execução limpa dele não é evidência de que não há
 * trabalho não aguardado. Foi essa inferência que eu quase guardei como conclusão.
 *
 * ## O que isto NÃO afirma
 *
 * Não afirmo que este era o flake. Ele não reproduziu em 34 execuções, apareceu
 * duas vezes com a mesma assinatura (`1 failed, 115 passed`, uma delas com o nome:
 * `read ECONNRESET` num teste de auth quatro arquivos depois dos testes do MCP), e
 * eu não consegui reproduzi-lo isolando os arquivos. Isto fecha uma **classe** que
 * é compatível com o sintoma e que o instrumento padrão não podia descartar.
 */
const pendentes = new Set<Promise<void>>();

export function registrarFechamento(promessa: Promise<void>): void {
  // `catch` ANTES de qualquer coisa, e o resultado do `catch` é o que entra no
  // conjunto — não a promessa original.
  //
  // A primeira versão fazia `pendentes.add(promessa)` e
  // `void promessa.finally(() => pendentes.delete(promessa))`. Duas coisas
  // erradas, e a segunda derruba o processo:
  //
  // 1. `.finally()` devolve uma promessa que REJEITA com o mesmo motivo, e o
  //    `void` a deixava sem tratamento. No Node 22 rejeição não tratada encerra
  //    o processo — a defesa contra trabalho não aguardado criando exatamente
  //    trabalho não aguardado, e pior que o original.
  // 2. O conjunto guardava a promessa que rejeita, então `Promise.allSettled` em
  //    `aguardarFechamentos` a absorvia, mas qualquer outro consumidor não.
  //
  // O caso adversário de `fechamentos.test.ts` é o que pegou isto: ele registra
  // uma rejeição de propósito. Sem ele a correção pareceria pronta, porque em
  // produção `Promise.allSettled(...).then(() => undefined)` nunca rejeita — o
  // caso de origem passava por construção.
  const rastreada = promessa.catch((erro: unknown) => {
    // Fechamento que falha não é motivo para derrubar nada: o servidor MCP daquela
    // requisição já respondeu. Registrar em log e seguir é o comportamento certo.
    logger.warn('falha ao fechar servidor MCP', erro);
  });

  pendentes.add(rastreada);
  void rastreada.then(() => pendentes.delete(rastreada));
}

/**
 * Espera todo fechamento em voo. Para uso em teardown de teste.
 *
 * Em laço porque aguardar um fechamento pode disparar outro — o `close` do
 * transporte encerra a resposta, e o handler de `close` da resposta registra mais
 * um. Uma única espera deixaria o segundo em voo, que é o defeito que esta função
 * existe para fechar.
 */
export async function aguardarFechamentos(): Promise<void> {
  while (pendentes.size > 0) {
    await Promise.allSettled([...pendentes]);
  }
}
