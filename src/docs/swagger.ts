import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Habits API',
    version: '1.0.0',
    description: 'API REST completa para gerenciamento de hábitos com gamificação',
    contact: {
      name: 'Matheus Caitano Batista',
      email: 'matheuscb@msn.com',
      url: 'https://github.com/matheus-cb',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3333',
      description: 'Development server',
    },
    {
      url: 'https://habits-api-production.up.railway.app',
      description: 'Production server',
    },
  ],
  tags: [
    {
      name: 'Auth',
      description: 'Authentication endpoints',
    },
    {
      name: 'Habits',
      description: 'Habits management',
    },
    {
      name: 'Checkins',
      description: 'Check-ins and statistics',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            example: 'error',
          },
          message: {
            type: 'string',
          },
          error: {
            type: 'string',
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          name: {
            type: 'string',
          },
          email: {
            type: 'string',
            format: 'email',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Habit: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          title: {
            type: 'string',
          },
          description: {
            type: 'string',
            nullable: true,
          },
          userId: {
            type: 'string',
            format: 'uuid',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Checkin: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          habitId: {
            type: 'string',
            format: 'uuid',
          },
          date: {
            type: 'string',
            format: 'date',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      HabitStats: {
        type: 'object',
        properties: {
          totalCheckins: {
            type: 'number',
          },
          currentStreak: {
            type: 'number',
          },
          bestStreak: {
            type: 'number',
          },
          completionRate: {
            type: 'number',
            format: 'float',
          },
        },
      },
    },
  },
  paths: {},
};

export function setupSwagger(app: Express): void {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}
