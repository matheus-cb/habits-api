import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

/**
 * Metadados da API — servidos em `/api-docs`, `/api-docs.json` e no recurso MCP
 * `habits://openapi`. Uma cópia, três consumidores.
 *
 * ## `paths` está vazio, e isto é dívida declarada
 *
 * Cada rota daqui precisaria de uma entrada escrita à mão descrevendo corpo,
 * resposta e status — a mesma informação que os schemas Zod de `src/schemas/` já
 * definem e **impõem**. Duas descrições do mesmo contrato, uma delas sem nada
 * comparando: é a forma que já apodreceu neste arquivo sem ninguém notar, e
 * preencher à mão só recomeçaria o apodrecimento.
 *
 * O contrato que o assistente MCP consulta é `habits://contratos`, DERIVADO dos
 * schemas por `z.toJSONSchema()`. Preencher `paths` a partir da mesma derivação é
 * o conserto de verdade, e está registrado como dívida em `AGENTS.md` em vez de
 * ser escrito à mão aqui.
 */
export const swaggerDocument = {
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
  // JSON antes da UI: quem consome contrato por programa não deve ter de raspar
  // HTML. Note que `paths` deste documento está VAZIO — ver o comentário de
  // `swaggerDocument`. O contrato de corpo real é `habits://contratos`, derivado
  // dos schemas Zod.
  app.get('/api-docs.json', (_req, res) => {
    res.json(swaggerDocument);
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}
