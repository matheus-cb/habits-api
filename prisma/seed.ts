import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function createCheckins(habitId: string, days: number[]) {
  for (const d of days) {
    await prisma.checkin.create({
      data: { habitId, date: daysAgo(d) },
    });
  }
}

async function main() {
  console.log('🌱 Starting database seed...');

  await prisma.checkin.deleteMany();
  await prisma.habit.deleteMany();
  await prisma.user.deleteMany();

  console.log('🗑️  Database cleaned');

  const hashedPassword = await bcrypt.hash('demo@2026', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Usuário Demo',
      email: 'demo@example.com',
      password: hashedPassword,
    },
  });

  console.log('👤 Demo user created:', user.email);

  // ─── Hábito 1: Streak longa ativa (28 dias consecutivos) ───────────────────
  const h1 = await prisma.habit.create({
    data: {
      title: 'Exercícios físicos',
      description: 'Praticar pelo menos 30 minutos de atividade física — corrida, musculação ou ciclismo',
      userId: user.id,
    },
  });
  await createCheckins(h1.id, Array.from({ length: 28 }, (_, i) => i)); // dias 0–27
  console.log('✅', h1.title);

  // ─── Hábito 2: Quase perfeito, algumas falhas nos fins de semana ───────────
  const h2 = await prisma.habit.create({
    data: {
      title: 'Ler livros',
      description: 'Ler pelo menos 20 páginas por dia',
      userId: user.id,
    },
  });
  // últimos 30 dias pulando sábados e domingos (a cada 7 dias, pular 2)
  const readDays: number[] = [];
  for (let i = 0; i < 30; i++) {
    const dow = new Date(Date.now() - i * 86400000).getDay(); // 0=dom, 6=sáb
    if (dow !== 0 && dow !== 6) readDays.push(i);
  }
  await createCheckins(h2.id, readDays);
  console.log('✅', h2.title);

  // ─── Hábito 3: Streak antiga boa, depois parou, voltou recentemente ────────
  const h3 = await prisma.habit.create({
    data: {
      title: 'Meditar',
      description: 'Sessão de meditação de 10 minutos com foco na respiração',
      userId: user.id,
    },
  });
  // streak antiga: dias 60–45 (16 dias consecutivos)
  const meditationOld = Array.from({ length: 16 }, (_, i) => 60 - i);
  // pausa de ~10 dias
  // voltou recentemente: dias 5–0 (últimos 6 dias)
  const meditationRecent = [5, 4, 3, 2, 1, 0];
  await createCheckins(h3.id, [...meditationOld, ...meditationRecent]);
  console.log('✅', h3.title);

  // ─── Hábito 4: Irregular (teste do gráfico com buracos variados) ──────────
  const h4 = await prisma.habit.create({
    data: {
      title: 'Beber 2L de água',
      description: 'Manter hidratação adequada ao longo do dia',
      userId: user.id,
    },
  });
  await createCheckins(h4.id, [0, 1, 2, 4, 5, 8, 9, 10, 12, 15, 16, 17, 20, 21, 25, 28, 29]);
  console.log('✅', h4.title);

  // ─── Hábito 5: Recente (criado há 10 dias, streak desde o início) ─────────
  const h5 = await prisma.habit.create({
    data: {
      title: 'Estudar inglês',
      description: 'Praticar 15 minutos no Duolingo ou assistir série sem legenda',
      userId: user.id,
      createdAt: daysAgo(10),
    },
  });
  await createCheckins(h5.id, Array.from({ length: 10 }, (_, i) => i)); // dias 0–9
  console.log('✅', h5.title);

  // ─── Hábito 6: Abandonado (último check-in há 20 dias) ───────────────────
  const h6 = await prisma.habit.create({
    data: {
      title: 'Journaling',
      description: 'Escrever pelo menos 3 parágrafos sobre o dia — reflexões e aprendizados',
      userId: user.id,
      createdAt: daysAgo(60),
    },
  });
  await createCheckins(h6.id, [20, 21, 22, 23, 24, 26, 27, 30, 31, 35, 40, 45, 50, 55, 58, 59]);
  console.log('✅', h6.title);

  // ─── Hábito 7: Alta consistência mas sem streak hoje ─────────────────────
  const h7 = await prisma.habit.create({
    data: {
      title: 'Dormir antes da meia-noite',
      description: 'Manter rotina de sono saudável, apagar as luzes até 23h30',
      userId: user.id,
    },
  });
  await createCheckins(h7.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 20, 21, 22, 24, 25, 27, 28, 29]);
  console.log('✅', h7.title);

  // ─── Hábito 8: Sem nenhum check-in ainda ─────────────────────────────────
  await prisma.habit.create({
    data: {
      title: 'Sem açúcar',
      description: 'Evitar doces e refrigerantes durante o dia',
      userId: user.id,
      createdAt: daysAgo(2),
    },
  });
  console.log('✅ Sem açúcar (sem check-ins)');

  console.log('');
  console.log('✨ Seed completed successfully!');
  console.log('');
  console.log('📝 Demo credentials:');
  console.log('   Email:    demo@example.com');
  console.log('   Password: demo@2026');
  console.log('');
  console.log('📊 Hábitos criados: 8');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
