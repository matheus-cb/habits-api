import request from 'supertest';
import { app } from '@/app';

describe('Auth Endpoints', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data.user).toHaveProperty('id');
      expect(response.body.data.user.email).toBe('test@example.com');
    });

    it('should not register user with duplicate email', async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      const response = await request(app).post('/api/v1/auth/register').send({
        name: 'Another User',
        email: 'test@example.com',
        password: 'password456',
      });

      expect(response.status).toBe(409);
    });

    it('should validate email format', async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'invalid-email',
        password: 'password123',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data).toHaveProperty('accessToken');
    });

    it('should not login with invalid password', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
    });

    it('should not login with non-existent email', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let token: string;

    beforeEach(async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      token = response.body.data.accessToken;
    });

    it('should get user profile with valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('test@example.com');
    });

    it('should not get profile without token', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/v1/auth/profile', () => {
    let token: string;

    beforeEach(async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      token = response.body.data.accessToken;
    });

    it('should update user name', async () => {
      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Name');
      expect(response.body.data.email).toBe('test@example.com');
    });

    it('should update user email', async () => {
      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'updated@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('updated@example.com');
    });

    it('should return 409 when email is already in use', async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Other User',
        email: 'other@example.com',
        password: 'password123',
      });

      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'other@example.com' });

      expect(response.status).toBe(409);
    });

    it('should return 400 when no fields are provided', async () => {
      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .put('/api/v1/auth/profile')
        .send({ name: 'New Name' });

      expect(response.status).toBe(401);
    });
  });
});
