import request from 'supertest';
import { app } from '@/app';

describe('Habits Endpoints', () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });
    token = response.body.data.accessToken;
    userId = response.body.data.user.id;
  });

  describe('POST /api/v1/habits', () => {
    it('should create a new habit', async () => {
      const response = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Exercise',
          description: 'Do 30 minutes of exercise',
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.data.title).toBe('Exercise');
    });

    it('should require authentication', async () => {
      const response = await request(app).post('/api/v1/habits').send({
        title: 'Exercise',
      });

      expect(response.status).toBe(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Missing title',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/habits', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Exercise',
        });
    });

    it('should get all user habits', async () => {
      const response = await request(app)
        .get('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
    });
  });

  describe('PUT /api/v1/habits/:id', () => {
    let habitId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Exercise',
        });
      habitId = response.body.data.id;
    });

    it('should update a habit', async () => {
      const response = await request(app)
        .put(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updated Exercise',
          description: 'New description',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Updated Exercise');
    });
  });

  describe('DELETE /api/v1/habits/:id', () => {
    let habitId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Exercise',
        });
      habitId = response.body.data.id;
    });

    it('should delete a habit', async () => {
      const response = await request(app)
        .delete(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(204);
    });
  });
});
