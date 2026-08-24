/**
 * Retenção de `ai_calls`: agrega o mês e descarta as linhas antigas.
 *
 * ## Por que só esta tabela
 *
 * `habit_revisions` e `conversation_messages` guardam **conteúdo** que a pessoa
 * pode querer daqui a um ano, e descartar por idade apaga exatamente o que se
 * quer recuperar de um erro antigo. `ai_calls` é o inverso em três eixos: o valor
 * decai, o volume cresce com uso e não com edição, e nada nela é recuperável — é
 * telemetria.
 *
 * "Três tabelas sem retenção" era um problema declarado três vezes; são dois
 * problemas diferentes, e este script resolve um.
 *
 * ## A ordem importa, e é a mesma do purge
 *
 * Agrega, **confere** que o agregado bate, e só então apaga. Apagar primeiro e
 * agregar depois perderia o mês inteiro se a agregação falhasse — e é o mesmo
 * raciocínio de INV-32: o purge exporta, relê e confere antes de destruir.
 *
 *   npm run reter:telemetria            # mostra o que faria
 *   npm run reter:telemetria -- --confirmar
 */
import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';

// Client CRU: `ai_calls` não tem soft delete e o descarte aqui é físico de
// propósito — é telemetria, não histórico. O client da aplicação recusaria
// `deleteMany` se a tabela estivesse nas listas da extensão, e ela não está.
const prisma = new PrismaClient();

async function main(): Promise<number> {
  const confirmado = process.argv.includes('--confirmar');
  const corte = new Date();
  corte.setUTCDate(corte.getUTCDate() - env.TELEMETRY_RETENTION_DAYS);
  corte.setUTCHours(0, 0, 0, 0);

  const antigas = await prisma.aiCall.count({ where: { createdAt: { lt: corte } } });

  console.log(`Corte:     ${corte.toISOString().slice(0, 10)} (UTC)`);
  console.log(`Retenção:  ${env.TELEMETRY_RETENTION_DAYS} dias`);
  console.log(`A agregar: ${antigas} chamada(s) mais antigas que o corte`);

  if (antigas === 0) {
    console.log('Nada a fazer.');
    return 0;
  }

  // Agrega POR MÊS, POR USUÁRIO, POR MOTOR. `date_trunc` em UTC pela mesma razão
  // de INV-04: um agregado que virasse à meia-noite local discordaria do resto do
  // sistema por três horas por dia.
  const grupos = await prisma.$queryRawUnsafe<
    { userId: string; month: Date; engine: string; calls: bigint; tokens: bigint; cost: unknown }[]
  >(
    `SELECT "userId",
            date_trunc('month', "createdAt" AT TIME ZONE 'UTC')::date AS month,
            engine,
            count(*)                        AS calls,
            coalesce(sum("outputTokens"),0) AS tokens,
            coalesce(sum("costUsd"),0)      AS cost
       FROM ai_calls
      WHERE "createdAt" < $1
      GROUP BY 1, 2, 3`,
    corte
  );

  console.log(`Grupos:    ${grupos.length} (usuário × mês × motor)`);

  if (!confirmado) {
    console.log('');
    console.log('Nada foi agregado nem apagado. Para executar, repita com --confirmar.');
    return 3;
  }

  // Em transação: o agregado e o descarte são uma operação só. Sem isto, uma
  // falha no meio deixaria o mês contado duas vezes na próxima execução — o
  // agregado já somado e as linhas ainda lá.
  const resultado = await prisma.$transaction(async (tx) => {
    for (const grupo of grupos) {
      // `upsert` porque o mês pode já ter agregado de uma execução anterior: o
      // corte é móvel e um mês parcial pode ser agregado hoje e completado depois.
      // Somar ao existente é o que torna o script idempotente por mês.
      await tx.aiUsageMonthly.upsert({
        where: {
          userId_month_engine: {
            userId: grupo.userId,
            month: grupo.month,
            engine: grupo.engine,
          },
        },
        create: {
          userId: grupo.userId,
          month: grupo.month,
          engine: grupo.engine,
          calls: Number(grupo.calls),
          outputTokens: grupo.tokens,
          costUsd: String(grupo.cost),
        },
        update: {
          calls: { increment: Number(grupo.calls) },
          outputTokens: { increment: grupo.tokens },
          costUsd: { increment: String(grupo.cost) },
        },
      });
    }

    const removidas = await tx.aiCall.deleteMany({ where: { createdAt: { lt: corte } } });

    // A conferência: o que se agregou tem de bater com o que se apagou. Se não
    // bater, a transação volta e nada é perdido — é o equivalente da releitura do
    // backup no purge.
    const somaAgregada = grupos.reduce((total, g) => total + Number(g.calls), 0);
    if (removidas.count !== somaAgregada) {
      throw new Error(
        `Agregado ${somaAgregada} chamadas e apagaria ${removidas.count}. ` +
          'Nada foi alterado — a diferença indica escrita concorrente durante a agregação.'
      );
    }

    return removidas.count;
  });

  console.log('');
  console.log(`Agregado e descartado: ${resultado} chamada(s) em ${grupos.length} grupo(s).`);
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
