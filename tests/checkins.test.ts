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
  });
});
