import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean database
  await prisma.checkin.deleteMany();
  await prisma.habit.deleteMany();
  await prisma.user.deleteMany();

  console.log('🗑️  Database cleaned');

  // Create demo user
  const hashedPassword = await bcrypt.hash('demo123', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email: 'demo@example.com',
      password: hashedPassword,
    },
  });

  console.log('👤 Demo user created:', user.email);

  // Create demo habits
  const habit1 = await prisma.habit.create({
    data: {
      title: 'Exercícios físicos',
      description: 'Praticar 30 minutos de exercícios',
      userId: user.id,
    },
  });

  const habit2 = await prisma.habit.create({
    data: {
      title: 'Ler livros',
      description: 'Ler pelo menos 20 páginas',
      userId: user.id,
    },
  });

  const habit3 = await prisma.habit.create({
    data: {
      title: 'Meditar',
      description: 'Meditar por 10 minutos',
      userId: user.id,
    },
  });

  console.log('✅ Habits created:', [habit1.title, habit2.title, habit3.title]);

  // Create some check-ins (last 7 days)
  const today = new Date();
  const checkins = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Habit 1: checked all days
    checkins.push(
      prisma.checkin.create({
        data: {
          habitId: habit1.id,
          date: date,
        },
      })
    );

    // Habit 2: checked 5 out of 7 days
    if (i < 5) {
      checkins.push(
        prisma.checkin.create({
          data: {
            habitId: habit2.id,
            date: date,
          },
        })
      );
    }

    // Habit 3: checked 3 out of 7 days
    if (i < 3) {
      checkins.push(
        prisma.checkin.create({
          data: {
            habitId: habit3.id,
            date: date,
          },
        })
      );
    }
  }

  await Promise.all(checkins);

  console.log('📊 Check-ins created');
  console.log('');
  console.log('✨ Seed completed successfully!');
  console.log('');
  console.log('📝 Demo credentials:');
  console.log('   Email: demo@example.com');
  console.log('   Password: demo123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
