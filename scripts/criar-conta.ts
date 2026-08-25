/**
 * Cria conta de usuário fora do HTTP. Contraparte de INV-42.
 *
 * Por que isto é um script e não uma rota: com o registro fechado, criar conta
 * deixa de ser operação de produto e passa a ser ato de quem administra a
 * instância. Mantendo-o fora da superfície HTTP, nenhuma flag mal configurada e
 * nenhum allowlist de assistente pode expô-lo — não há rota para expor. É a
 * mesma proteção topológica de `purge.ts`, e pelo mesmo motivo: a ausência de
 * rota não depende de ninguém lembrar de uma regra.
 *
 * A senha é gerada aqui, nunca recebida por argumento. Senha em `process.argv`
 * vaza para o histórico do shell e para a lista de processos da máquina, e este
 * script roda justamente no servidor onde isso é mais visível. Ela é impressa
 * UMA vez; não há como recuperá-la depois, porque o que fica no banco é o hash.
 *
 * Uso:
 *   npx tsx scripts/criar-conta.ts <nome> <email>              # mostra o que faria
 *   npx tsx scripts/criar-conta.ts <nome> <email> --confirmar
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { authConfig } from '@/config/auth';

// Client CRU, como em `purge.ts` e `reter-telemetria.ts`: a extensão de soft
// delete do client da aplicação existe para proteger o caminho HTTP, e script
// operacional não é caminho HTTP. Aqui só se escreve, mas a regra do repositório
// é a mesma nos três — um único jeito de um script falar com o banco.
const prisma = new PrismaClient();

/**
 * Senha aleatória legível de digitar.
 *
 * 24 caracteres de um alfabeto sem `0/O` e `1/l/I`: a senha vai ser lida de um
 * terminal e digitada num navegador, e confundir zero com O é o erro que faz
 * alguém concluir que o script não funcionou.
 *
 * `randomInt` e não `randomBytes % n`: o módulo enviesa quando o tamanho do
 * alfabeto não divide 256, e não há razão para aceitar viés aqui.
 */
function senhaAleatoria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < 24; i += 1) {
    senha += alfabeto[crypto.randomInt(alfabeto.length)];
  }
  return senha;
}

async function main(): Promise<number> {
  const argumentos = process.argv.slice(2);
  const confirmado = argumentos.includes('--confirmar');
  const [nome, email] = argumentos.filter((a) => a !== '--confirmar');

  if (!nome || !email) {
    console.error('Uso: npx tsx scripts/criar-conta.ts <nome> <email> [--confirmar]');
    return 2;
  }
  if (!email.includes('@')) {
    console.error(`"${email}" não parece um e-mail.`);
    return 2;
  }

  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    console.error(`Já existe conta para ${email} (id ${existente.id}). Nada foi alterado.`);
    return 2;
  }

  console.log('');
  console.log(`Nome:   ${nome}`);
  console.log(`E-mail: ${email}`);
  console.log(`Hash:   bcrypt, ${authConfig.saltRounds} rounds`);
  console.log('Senha:  gerada na execução, 24 caracteres, exibida uma única vez');

  if (!confirmado) {
    console.log('');
    console.log('Nada foi criado. Para executar, repita com --confirmar.');
    return 3;
  }

  // `authConfig.saltRounds` e não o literal 10. O `prisma/seed.ts` escreve o 10
  // à mão, e é justamente a divergência que faz o custo do hash mudar num lugar
  // e não no outro quando alguém ajusta a configuração.
  const senha = senhaAleatoria();
  const criado = await prisma.user.create({
    data: { name: nome, email, password: await bcrypt.hash(senha, authConfig.saltRounds) },
    select: { id: true, email: true },
  });

  console.log('');
  console.log(`Conta criada: ${criado.email} (id ${criado.id})`);
  console.log('');
  console.log(`    senha: ${senha}`);
  console.log('');
  console.log('Ela não será mostrada de novo — o banco guarda só o hash.');
  return 0;
}

main()
  .then((codigo) => prisma.$disconnect().then(() => process.exit(codigo)))
  .catch(async (erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    await prisma.$disconnect();
    process.exit(1);
  });
