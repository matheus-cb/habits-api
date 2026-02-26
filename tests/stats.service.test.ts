import { StatsService } from '@/services/stats.service';

// ---------------------------------------------------------------------------
// Repository mocks (variables start with "mock" to allow jest.mock hoisting)
// ---------------------------------------------------------------------------

const mockCheckinsRepository = {
  findByHabitId: jest.fn(),
  findByHabitIdAndDateRange: jest.fn(),
};

const mockHabitsRepository = {
  findById: jest.fn(),
};

// Service under test using injected mocks
const statsService = new StatsService(
  mockCheckinsRepository as any,
  mockHabitsRepository as any
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HABIT_ID = 'habit-uuid-1';
const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';

const mockHabit = {
  id: HABIT_ID,
  userId: USER_ID,
  title: 'Test Habit',
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Build a Date at noon, N calendar days before today (local time). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeCheckin(id: string, offsetDays: number) {
  return {
    id,
    habitId: HABIT_ID,
    date: daysAgo(offsetDays),
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatsService.getHabitStats', () => {
  // jest.config.js has clearMocks/resetMocks/restoreMocks = true, but explicit
  // setup inside each test using mockResolvedValueOnce is still the clearest.

  describe('authorization checks', () => {
    // Note: AppError uses Object.setPrototypeOf(this, AppError.prototype) in its
    // constructor, which breaks instanceof checks for subclasses. We therefore
    // assert on statusCode and message rather than error class identity.

    it('throws a 404 error with the right message when the habit does not exist', async () => {
      mockHabitsRepository.findById.mockResolvedValueOnce(null);

      await expect(statsService.getHabitStats(HABIT_ID, USER_ID)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Habit not found',
      });
    });

    it('throws a 403 error when the habit belongs to a different user', async () => {
      mockHabitsRepository.findById.mockResolvedValue({ ...mockHabit, userId: OTHER_USER_ID });

      await expect(statsService.getHabitStats(HABIT_ID, USER_ID)).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('zero-state habit', () => {
    it('returns all-zero stats for a habit with no checkins', async () => {
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce([]);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce([]);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.totalCheckins).toBe(0);
      expect(stats.currentStreak).toBe(0);
      expect(stats.bestStreak).toBe(0);
      expect(stats.completionRate).toBe(0);
    });
  });

  describe('totalCheckins', () => {
    it('counts all checkins regardless of date', async () => {
      const checkins = [
        makeCheckin('c1', 30),
        makeCheckin('c2', 15),
        makeCheckin('c3', 0),
      ];
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(checkins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce([checkins[2]]);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.totalCheckins).toBe(3);
    });
  });

  describe('currentStreak', () => {
    it('returns correct streak for consecutive days ending today', async () => {
      const checkins = [
        makeCheckin('c1', 0),
        makeCheckin('c2', 1),
        makeCheckin('c3', 2),
      ];
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(checkins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(checkins);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.currentStreak).toBe(3);
    });

    it('returns 0 when the last checkin was 2+ days ago', async () => {
      const checkins = [makeCheckin('c1', 3), makeCheckin('c2', 4)];
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(checkins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce([]);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.currentStreak).toBe(0);
    });
  });

  describe('bestStreak', () => {
    it('returns bestStreak equal to currentStreak when no longer historical run exists', async () => {
      const checkins = [makeCheckin('c1', 0), makeCheckin('c2', 1)];
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(checkins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(checkins);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.bestStreak).toBe(2);
      expect(stats.bestStreak).toBe(stats.currentStreak);
    });

    it('returns historical bestStreak when it is longer than the current streak', async () => {
      // Current streak: 2 days (today + yesterday)
      // Historical best: 5 consecutive days (10–6 days ago)
      const checkins = [
        makeCheckin('c1', 0),
        makeCheckin('c2', 1),
        // gap at days 2–5
        makeCheckin('c3', 6),
        makeCheckin('c4', 7),
        makeCheckin('c5', 8),
        makeCheckin('c6', 9),
        makeCheckin('c7', 10),
      ];
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(checkins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(
        checkins.slice(0, 2) // only today + yesterday within recent range
      );

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.currentStreak).toBe(2);
      expect(stats.bestStreak).toBe(5);
    });
  });

  describe('completionRate', () => {
    it('calculates completionRate as (recentCheckins / 30) * 100', async () => {
      // 15 checkins in the last 30 days → 50 %
      const recentCheckins = Array.from({ length: 15 }, (_, i) => makeCheckin(String(i), i));
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(recentCheckins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(recentCheckins);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.completionRate).toBe(50);
    });

    it('rounds completionRate to 2 decimal places', async () => {
      // 10 checkins in 30 days → 33.333...% → rounded to 33.33
      const recentCheckins = Array.from({ length: 10 }, (_, i) => makeCheckin(String(i), i));
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(recentCheckins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(recentCheckins);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.completionRate).toBe(33.33);
    });

    it('caps completionRate at 100 when all 30 days are checked in', async () => {
      const recentCheckins = Array.from({ length: 30 }, (_, i) => makeCheckin(String(i), i));
      mockHabitsRepository.findById.mockResolvedValueOnce(mockHabit);
      mockCheckinsRepository.findByHabitId.mockResolvedValueOnce(recentCheckins);
      mockCheckinsRepository.findByHabitIdAndDateRange.mockResolvedValueOnce(recentCheckins);

      const stats = await statsService.getHabitStats(HABIT_ID, USER_ID);

      expect(stats.completionRate).toBe(100);
    });
  });
});
