import request from 'supertest';
import { app } from '@/app';

describe('Checkins Endpoints', () => {
  let token: string;
  let habitId: string;

  beforeEach(async () => {
    const authResponse = await request(app).post('/api/v1/auth/register').send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });
    token = authResponse.body.data.accessToken;

    const habitResponse = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Exercise',
      });
    habitId = habitResponse.body.data.id;
  });

  describe('POST /api/v1/habits/:habitId/checkin', () => {
    it('should create a check-in', async () => {
      const response = await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.data.habitId).toBe(habitId);
    });

    it('should not create duplicate check-in for same day', async () => {
      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const response = await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(409);
    });
  });

  describe('GET /api/v1/habits/:habitId/checkins', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    });

    it('should get all check-ins for a habit', async () => {
      const response = await request(app)
        .get(`/api/v1/habits/${habitId}/checkins`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/habits/:habitId/stats', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    });

    it('should get habit statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/habits/${habitId}/stats`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('totalCheckins');
      expect(response.body.data).toHaveProperty('currentStreak');
      expect(response.body.data).toHaveProperty('completionRate');
      expect(response.body.data.totalCheckins).toBeGreaterThan(0);
    });

    it('should return bestStreak greater than currentStreak when streak was broken', async () => {
      // Create check-ins for 3 consecutive days in the past (streak broken since then)
      const pastDate1 = new Date();
      pastDate1.setDate(pastDate1.getDate() - 10);
      const pastDate2 = new Date();
      pastDate2.setDate(pastDate2.getDate() - 9);
      const pastDate3 = new Date();
      pastDate3.setDate(pastDate3.getDate() - 8);

      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: pastDate1.toISOString() });

      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: pastDate2.toISOString() });

      await request(app)
        .post(`/api/v1/habits/${habitId}/checkin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: pastDate3.toISOString() });

      // Skip a few days (gap), breaking the streak
      // The beforeEach already created a check-in for today (currentStreak = 1)
      // But the historical streak was 3 days

      const response = await request(app)
        .get(`/api/v1/habits/${habitId}/stats`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.bestStreak).toBeGreaterThanOrEqual(3);
      expect(response.body.data.bestStreak).toBeGreaterThanOrEqual(
        response.body.data.currentStreak
      );
    });
  });
});
