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

  const checkins = await prisma.checkin.findMany({ where: { habitId } });

  console.log(`Hábito:    ${habito.title} (${habitId})`);
  console.log(`Apagado em: ${habito.deletedAt.toISOString()}`);
  console.log(`Check-ins:  ${checkins.length} — TODOS serão destruídos, sem volta`);

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

  const conteudo = JSON.stringify({ habito, checkins }, null, 2);
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
    habito: { id: string };
    checkins: unknown[];
  };

  if (relido.habito?.id !== habitId || relido.checkins.length !== checkins.length) {
    fs.unlinkSync(parcial);
    console.error(
      `Backup incompleto: esperava ${checkins.length} check-ins e reli ${relido.checkins?.length ?? 0}.`
    );
    console.error('Nada foi apagado.');
    return 1;
  }

  // Só depois de validado o arquivo recebe o nome final. `rename` é atômico no
  // mesmo sistema de arquivos, então nunca existe um `.json` pela metade.
  fs.renameSync(parcial, destino);
  console.log(`Backup:     ${destino} (${relido.checkins.length} check-ins conferidos)`);

  if (!confirmado) {
    console.log('');
    console.log('Nada foi apagado. Para executar, repita com --confirmar.');
    return 3;
  }

  // O cascade do banco leva os check-ins; o delete explícito antes existe para o
  // número apagado aparecer no output, em vez de acontecer em silêncio.
  const removidos = await prisma.checkin.deleteMany({ where: { habitId } });
  await prisma.habit.delete({ where: { id: habitId } });

  console.log('');
  console.log(`Purgado: 1 hábito e ${removidos.count} check-ins.`);
  return 0;
}

main()
  .then((codigo) => prisma.$disconnect().then(() => process.exit(codigo)))
  .catch(async (erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    await prisma.$disconnect();
    process.exit(1);
  });
