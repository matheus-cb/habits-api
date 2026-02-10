# Arquitetura - Habits API

Documentação da arquitetura e design patterns utilizados no projeto.

## 🏗️ Visão Geral

A API segue princípios de **Clean Architecture** com separação clara de responsabilidades e baixo acoplamento entre camadas.

## 📐 Camadas da Aplicação

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│     (Controllers + Routes + Docs)       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         Application Layer               │
│    (Services + Use Cases + DTOs)        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         Domain Layer                    │
│    (Entities + Business Rules)          │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│      Infrastructure Layer               │
│  (Repositories + Database + External)   │
└─────────────────────────────────────────┘
```

---

## 📂 Estrutura de Pastas Detalhada

```
src/
├── config/                    # Configurações da aplicação
│   ├── env.ts                # Validação de variáveis de ambiente
│   ├── database.ts           # Configuração do Prisma
│   └── auth.ts               # Configuração JWT
│
├── controllers/              # Presentation Layer
│   ├── auth.controller.ts    # Controlador de autenticação
│   ├── habits.controller.ts  # Controlador de hábitos
│   └── checkins.controller.ts # Controlador de check-ins
│
├── services/                 # Application Layer
│   ├── auth.service.ts       # Lógica de autenticação
│   ├── habits.service.ts     # Lógica de hábitos
│   ├── checkins.service.ts   # Lógica de check-ins
│   └── stats.service.ts      # Cálculos de estatísticas
│
├── repositories/             # Infrastructure Layer
│   ├── users.repository.ts   # Acesso a dados de usuários
│   ├── habits.repository.ts  # Acesso a dados de hábitos
│   └── checkins.repository.ts # Acesso a dados de check-ins
│
├── middlewares/              # Middlewares
│   ├── auth.middleware.ts    # Validação JWT
│   ├── validation.middleware.ts # Validação de schemas
│   ├── error.middleware.ts   # Tratamento de erros
│   └── logger.middleware.ts  # Logging de requisições
│
├── routes/                   # Definição de rotas
│   ├── index.ts             # Agregador de rotas
│   ├── auth.routes.ts       # Rotas de autenticação
│   ├── habits.routes.ts     # Rotas de hábitos
│   └── checkins.routes.ts   # Rotas de check-ins
│
├── schemas/                  # Validação com Zod
│   ├── auth.schema.ts       # Schemas de autenticação
│   ├── habits.schema.ts     # Schemas de hábitos
│   └── checkins.schema.ts   # Schemas de check-ins
│
├── types/                    # Tipos TypeScript
│   ├── express.d.ts         # Extensões do Express
│   ├── auth.types.ts        # Tipos de autenticação
│   ├── habit.types.ts       # Tipos de hábitos
│   └── api.types.ts         # Tipos gerais da API
│
├── utils/                    # Utilitários
│   ├── errors.ts            # Classes de erro customizadas
│   ├── response.ts          # Padronização de respostas
│   ├── logger.ts            # Logger estruturado
│   └── helpers.ts           # Funções auxiliares
│
├── docs/                     # Configuração Swagger
│   └── swagger.ts           # Definições OpenAPI
│
├── app.ts                    # Configuração do Express
└── server.ts                 # Entry point da aplicação
```

---

## 🔄 Fluxo de Requisição

```
1. Cliente faz requisição HTTP
        ↓
2. Express recebe e aplica middlewares globais
   (logger, cors, helmet, body-parser)
        ↓
3. Roteador direciona para rota específica
        ↓
4. Middleware de autenticação (se necessário)
        ↓
5. Middleware de validação (Zod)
        ↓
6. Controller processa requisição
        ↓
7. Controller chama Service
        ↓
8. Service executa lógica de negócio
        ↓
9. Service chama Repository
        ↓
10. Repository acessa banco (Prisma)
        ↓
11. Dados retornam pela camada inversa
        ↓
12. Controller formata resposta
        ↓
13. Middleware de erro (se houver)
        ↓
14. Resposta JSON enviada ao cliente
```

---

## 🎯 Design Patterns Utilizados

### 1. **Repository Pattern**
Abstrai acesso ao banco de dados.

```typescript
// repositories/habits.repository.ts
export class HabitsRepository {
  async findById(id: string) {
    return prisma.habit.findUnique({ where: { id } });
  }

  async create(data: CreateHabitData) {
    return prisma.habit.create({ data });
  }
}
```

### 2. **Service Layer Pattern**
Centraliza lógica de negócio.

```typescript
// services/habits.service.ts
export class HabitsService {
  constructor(private repository: HabitsRepository) {}

  async createHabit(userId: string, data: CreateHabitDTO) {
    // Validações de negócio
    // Transformações
    return this.repository.create({ ...data, userId });
  }
}
```

### 3. **Dependency Injection**
Facilita testes e desacoplamento.

```typescript
// controllers/habits.controller.ts
export class HabitsController {
  constructor(private service: HabitsService) {}

  async create(req: Request, res: Response) {
    const habit = await this.service.createHabit(req.user.id, req.body);
    return res.status(201).json(habit);
  }
}
```

### 4. **Factory Pattern**
Criação de instâncias complexas.

```typescript
// factories/services.factory.ts
export function createHabitsService() {
  const repository = new HabitsRepository();
  return new HabitsService(repository);
}
```

### 5. **Middleware Pattern**
Processamento em cadeia de requisições.

```typescript
// middlewares/auth.middleware.ts
export function authenticate(req, res, next) {
  const token = extractToken(req);
  const user = verifyToken(token);
  req.user = user;
  next();
}
```

---

## 🗄️ Modelo de Dados

### Schema do Prisma

```prisma
model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  password  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  habits    Habit[]

  @@map("users")
}

model Habit {
  id          String   @id @default(uuid())
  title       String
  description String?
  userId      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  checkins    Checkin[]

  @@map("habits")
}

model Checkin {
  id        String   @id @default(uuid())
  habitId   String
  date      DateTime @default(now())
  createdAt DateTime @default(now())

  habit     Habit    @relation(fields: [habitId], references: [id], onDelete: Cascade)

  @@unique([habitId, date])
  @@map("checkins")
}
```

### Relacionamentos

```
User 1:N Habit
  - Um usuário tem muitos hábitos
  - Um hábito pertence a um usuário

Habit 1:N Checkin
  - Um hábito tem muitos check-ins
  - Um check-in pertence a um hábito

User -> Habit -> Checkin (cascade delete)
```

---

## 🔐 Segurança

### Autenticação JWT

```
1. Usuário envia email/senha
2. API valida credenciais
3. API gera token JWT com payload:
   {
     userId: string,
     email: string,
     iat: number,
     exp: number
   }
4. Cliente armazena token
5. Cliente envia token em todas requisições:
   Authorization: Bearer <token>
6. Middleware valida token
7. Middleware anexa dados do usuário em req.user
```

### Hash de Senhas

```typescript
// Registro
const hashedPassword = await bcrypt.hash(password, 10);

// Login
const isValid = await bcrypt.compare(password, user.password);
```

### Validação de Dados

```typescript
// Usando Zod
const createHabitSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().optional()
});

// Middleware aplica validação
validateBody(createHabitSchema)
```

---

## ⚡ Performance

### Otimizações Implementadas

1. **Indexes no Banco**
   - email (único) em Users
   - userId em Habits
   - habitId + date (único) em Checkins

2. **Query Optimization**
   - Select apenas campos necessários
   - Eager loading com include quando necessário
   - Paginação em listagens

3. **Caching** (futuro)
   - Redis para sessões
   - Cache de estatísticas calculadas

---

## 📊 Tratamento de Erros

### Hierarquia de Erros

```typescript
class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
}

class BadRequestError extends AppError {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`);
    this.statusCode = 404;
  }
}
```

### Middleware de Erro Global

```typescript
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message
    });
  }

  // Erro não esperado
  logger.error(err);
  return res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});
```

---

## 🧪 Testabilidade

### Estratégia de Testes

```
Unit Tests (70%)
  - Services
  - Utils
  - Middlewares

Integration Tests (25%)
  - Controllers + Services + Repository
  - Fluxos completos

E2E Tests (5%)
  - Principais fluxos de usuário
```

### Exemplo de Teste

```typescript
describe('HabitsService', () => {
  it('should create a habit', async () => {
    const mockRepository = {
      create: jest.fn().mockResolvedValue(mockHabit)
    };

    const service = new HabitsService(mockRepository);
    const habit = await service.createHabit('user-id', data);

    expect(habit).toBeDefined();
    expect(mockRepository.create).toHaveBeenCalledWith({
      ...data,
      userId: 'user-id'
    });
  });
});
```

---

## 🚀 Escalabilidade

### Preparado para crescer

1. **Horizontal Scaling**
   - Stateless (JWT em vez de sessions)
   - Pode adicionar load balancer

2. **Database Scaling**
   - Indexes otimizados
   - Preparado para read replicas
   - Queries eficientes

3. **Microservices Ready**
   - Camadas bem separadas
   - Fácil extrair serviços específicos

---

## 📝 Convenções de Código

### Nomenclatura

- **Arquivos**: kebab-case (`auth.controller.ts`)
- **Classes**: PascalCase (`AuthController`)
- **Funções**: camelCase (`createHabit`)
- **Constantes**: UPPER_SNAKE_CASE (`JWT_SECRET`)
- **Interfaces**: PascalCase com I prefix (`IUser`)
- **Types**: PascalCase (`UserPayload`)

### Estrutura de Commits

```
feat: add habits CRUD
fix: correct streak calculation
docs: update API documentation
test: add checkins service tests
refactor: improve error handling
chore: update dependencies
```

---

Última atualização: 2026-01-18
