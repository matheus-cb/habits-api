/**
 * Delete FÍSICO de hábito. Ação direta da pessoa, fora do HTTP.
 *
 * Por que isto é um script e não uma rota: apagar um hábito de verdade destrói
 * todo o histórico de check-ins por cascade, e o histórico é o valor inteiro do
 * app. Deixando-o fora da superfície HTTP, nenhum allowlist de assistente pode
 * expô-lo por engano — não há rota para expor. A proteção é topológica, não uma
 * regra que alguém precise lembrar de aplicar.
 *
 * Ele exige que o hábito já esteja apagado logicamente, então o caminho é sempre
 * o mesmo: apagar pela API (reversível), conferir, e só então purgar. E exporta
 * antes, porque um `rm -rf` que não mostra o alcance antes de agir foi
 * exatamente o defeito que custou um banco de desenvolvimento nesta semana.
 *
 * Uso:
 *   npx tsx scripts/purge.ts <habitId>            # mostra o que sairia
 *   npx tsx scripts/purge.ts <habitId> --confirmar
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

// Client CRU, sem a extensão de soft delete: purgar precisa alcançar o apagado.
const prisma = new PrismaClient();

async function main(): Promise<number> {
  const [habitId, ...resto] = process.argv.slice(2);
  const confirmado = resto.includes('--confirmar');

  if (!habitId) {
    console.error('Uso: npx tsx scripts/purge.ts <habitId> [--confirmar]');
    return 2;
  }

  const habito = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!habito) {
    console.error(`Hábito ${habitId} não existe.`);
    return 1;
  }

  if (!habito.deletedAt) {
    console.error(
      [
        `O hábito "${habito.title}" está ATIVO.`,
        'Purgar só é permitido depois do delete lógico — apague pela API primeiro',
        'e confira o efeito. O caminho de duas etapas é a proteção.',
      ].join('\n')
    );
    return 1;
  }

  // TODAS as tabelas filhas, e não as que eu lembrei de listar.
  //
  // A primeira versão buscava só check-ins, e a FK de `habit_revisions` é
  // `ON DELETE CASCADE` — então o DELETE físico apagava o histórico de edição
  // inteiro, que não estava no JSON exportado e não aparecia na contagem que o
  // operador lê antes de digitar `--confirmar`.
  //
  // Duas falhas empilhadas, e a segunda é a grave. O export incompleto se
  // conserta; a MENSAGEM incompleta significa que quem confirmou consentiu com
  // menos do que aconteceu. Neste caminho não há allowlist, não há RLS e não há
  // confirmação de cliente: a única barreira é uma pessoa lendo um resumo. Numa
  // arquitetura construída sobre "a decisão é do usuário", é a linha que mais
  // precisa estar completa.
  //
  // O teste de INV-32 enumera as FKs com `ON DELETE CASCADE` apontando para
  // `habits` e exige que cada tabela esteja aqui, para que a próxima filha não
  // repita isto.
  const checkins = await prisma.checkin.findMany({ where: { habitId } });
  const revisoes = await prisma.habitRevision.findMany({
    where: { habitId },
    orderBy: { ordem: 'asc' },
  });

  console.log(`Hábito:     ${habito.title} (${habitId})`);
  console.log(`Apagado em: ${habito.deletedAt.toISOString()}`);
  console.log(`Check-ins:  ${checkins.length} — TODOS serão destruídos, sem volta`);
  console.log(`Revisões:   ${revisoes.length} — o histórico de edição inteiro, sem volta`);

  // Exporta antes de destruir — e RELÊ antes de confiar.
  //
  // `writeFileSync` lança na maioria dos erros, mas não nos que importam: disco
  // cheio pode gravar parcial. Sem a releitura, o `--confirmar` confirmaria um
  // backup que ninguém abriu, e é a mesma distinção entre intenção e efeito que
  // fez uma mensagem de commit descrever uma edição que não aconteceu.
  const destino = path.join(
    process.cwd(),
    `purge-${habitId}-${habito.deletedAt.toISOString().replace(/[:.]/g, '-')}.json`
  );
  const parcial = `${destino}.parcial`;

  // O `replacer` existe porque `ordem` é `BIGSERIAL` e `JSON.stringify` recusa
  // `BigInt`. Serializa como string em vez de `Number`: acima de 2^53 o `Number`
  // perde precisão em silêncio, e um backup com a sequência corrompida é pior que
  // um backup que falha ao gravar.
  const conteudo = JSON.stringify(
    { habito, checkins, revisoes },
    (_chave, valor) => (typeof valor === 'bigint' ? valor.toString() : valor),
    2
  );
  const descritor = fs.openSync(parcial, 'w');
  try {
    fs.writeFileSync(descritor, conteudo);
    // `fsync` antes de fechar: sem ele o dado pode estar só no cache do sistema,
    // e um corte de energia entre o export e o delete perderia os dois.
    fs.fsyncSync(descritor);
  } finally {
    fs.closeSync(descritor);
  }

  // A releitura é o que transforma "gravei" em "está lá e está completo".
  const relido = JSON.parse(fs.readFileSync(parcial, 'utf8')) as {
    habito?: { id: string };
    checkins?: unknown[];
    revisoes?: unknown[];
  };

  // A releitura confere as TRÊS coleções. Conferir duas e exportar três é a forma
  // exata do defeito acima: a verificação cobre a lista que existia quando ela foi
  // escrita, e o que entrou depois passa sem ser olhado.
  const conferencias: [string, number, number][] = [
    ['check-ins', checkins.length, relido.checkins?.length ?? -1],
    ['revisões', revisoes.length, relido.revisoes?.length ?? -1],
  ];
  const divergentes = conferencias.filter(([, esperado, lido]) => esperado !== lido);

  if (relido.habito?.id !== habitId || divergentes.length > 0) {
    fs.unlinkSync(parcial);
    for (const [nome, esperado, lido] of divergentes) {
      console.error(`Backup incompleto: esperava ${esperado} ${nome} e reli ${lido}.`);
    }
    if (relido.habito?.id !== habitId) {
      console.error(`Backup incompleto: o hábito relido não é ${habitId}.`);
    }
    console.error('Nada foi apagado.');
    return 1;
  }

  // Só depois de validado o arquivo recebe o nome final. `rename` é atômico no
  // mesmo sistema de arquivos, então nunca existe um `.json` pela metade.
  fs.renameSync(parcial, destino);
  // A linha de confirmação enumera as MESMAS coleções que a releitura conferiu, e
  // ela é gerada da lista em vez de escrita à mão. A primeira versão dizia só
  // "N check-ins conferidos" enquanto o export já tinha três coleções — a mesma
  // incompletude que este commit conserta, repetida um parágrafo abaixo. Derivar
  // da lista é o que impede a terceira vez.
  const conferido = conferencias.map(([nome, esperado]) => `${esperado} ${nome}`).join(', ');
  console.log(`Backup:     ${destino} (${conferido} conferidos)`);

  if (!confirmado) {
    console.log('');
    console.log('Nada foi apagado. Para executar, repita com --confirmar.');
    return 3;
  }

  // O cascade do banco levaria as duas filhas; os deletes explícitos antes existem
  // para o número apagado aparecer no output em vez de acontecer em silêncio.
  //
  // Terceira instância da mesma omissão neste arquivo: o resumo de antes, a linha
  // do backup e este relatório final, cada um enumerando uma lista de coleções
  // diferente. A correção é a mesma nos três — não escrever a lista, derivá-la.
  const removidos = await prisma.checkin.deleteMany({ where: { habitId } });
  const revisoesRemovidas = await prisma.habitRevision.deleteMany({ where: { habitId } });
  await prisma.habit.delete({ where: { id: habitId } });

  const destruido = [
    ['check-ins', removidos.count],
    ['revisões', revisoesRemovidas.count],
  ] as const;

  console.log('');
  console.log(
    `Purgado: 1 hábito, ${destruido.map(([nome, n]) => `${n} ${nome}`).join(' e ')}.`
  );
  return 0;
}

main()
  .then((codigo) => prisma.$disconnect().then(() => process.exit(codigo)))
  .catch(async (erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    await prisma.$disconnect();
    process.exit(1);
  });
