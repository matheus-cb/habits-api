-- AlterTable
ALTER TABLE "habits" ADD COLUMN     "scheduledDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
