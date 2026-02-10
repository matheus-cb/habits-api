// Test setup file
import { prisma } from '@/config/database';

// Cleanup database before each test
beforeEach(async () => {
  await prisma.checkin.deleteMany();
  await prisma.habit.deleteMany();
  await prisma.user.deleteMany();
});

// Disconnect after all tests
afterAll(async () => {
  await prisma.$disconnect();
});
