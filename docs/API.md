# API Documentation

Documentação detalhada dos endpoints da Habits API.

## Base URL

```
http://localhost:3333/api/v1
```

## Autenticação

A maioria dos endpoints requer autenticação via JWT token no header:

```
Authorization: Bearer <token>
```

---

## 📌 Endpoints

### Autenticação

#### POST /auth/register
Registra um novo usuário.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response (201):**
```json
{
  "status": "success",
  "message": "User registered successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

#### POST /auth/login
Faz login e retorna token JWT.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "status": "success",
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

#### GET /auth/me
Retorna dados do usuário autenticado.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2026-01-18T10:00:00.000Z"
  }
}
```

---

### Hábitos

#### GET /habits
Lista todos os hábitos do usuário.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "status": "success",
  "data": [
    {
      "id": "uuid",
      "title": "Exercícios",
      "description": "Praticar 30 minutos de exercícios",
      "userId": "uuid",
      "createdAt": "2026-01-18T10:00:00.000Z",
      "updatedAt": "2026-01-18T10:00:00.000Z"
    }
  ]
}
```

#### POST /habits
Cria um novo hábito.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "title": "Exercícios",
  "description": "Praticar 30 minutos de exercícios" // opcional
}
```

**Response (201):**
```json
{
  "status": "success",
  "message": "Habit created successfully",
  "data": {
    "id": "uuid",
    "title": "Exercícios",
    "description": "Praticar 30 minutos de exercícios",
    "userId": "uuid",
    "createdAt": "2026-01-18T10:00:00.000Z",
    "updatedAt": "2026-01-18T10:00:00.000Z"
  }
}
```

#### GET /habits/:id
Busca um hábito específico.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "title": "Exercícios",
    "description": "Praticar 30 minutos de exercícios",
    "userId": "uuid",
    "createdAt": "2026-01-18T10:00:00.000Z",
    "updatedAt": "2026-01-18T10:00:00.000Z"
  }
}
```

#### PUT /habits/:id
Atualiza um hábito.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "title": "Exercícios Updated", // opcional
  "description": "Nova descrição" // opcional
}
```

**Response (200):**
```json
{
  "status": "success",
  "message": "Habit updated successfully",
  "data": {
    "id": "uuid",
    "title": "Exercícios Updated",
    "description": "Nova descrição",
    "userId": "uuid",
    "createdAt": "2026-01-18T10:00:00.000Z",
    "updatedAt": "2026-01-18T11:00:00.000Z"
  }
}
```

#### DELETE /habits/:id
Deleta um hábito.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (204):**
```
No content
```

---

### Check-ins

#### POST /habits/:habitId/checkin
Cria um check-in para um hábito (marca como concluído).

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body (opcional):**
```json
{
  "date": "2026-01-18T10:00:00.000Z" // opcional, default é hoje
}
```

**Response (201):**
```json
{
  "status": "success",
  "message": "Check-in created successfully",
  "data": {
    "id": "uuid",
    "habitId": "uuid",
    "date": "2026-01-18T00:00:00.000Z",
    "createdAt": "2026-01-18T10:00:00.000Z"
  }
}
```

#### GET /habits/:habitId/checkins
Lista todos os check-ins de um hábito.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "status": "success",
  "data": [
    {
      "id": "uuid",
      "habitId": "uuid",
      "date": "2026-01-18T00:00:00.000Z",
      "createdAt": "2026-01-18T10:00:00.000Z"
    }
  ]
}
```

#### GET /habits/:habitId/stats
Retorna estatísticas de um hábito.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "totalCheckins": 15,
    "currentStreak": 7,
    "bestStreak": 7,
    "completionRate": 50.0
  }
}
```

---

## 🔴 Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 400 | Bad Request - Dados inválidos |
| 401 | Unauthorized - Token inválido ou ausente |
| 403 | Forbidden - Sem permissão para acessar recurso |
| 404 | Not Found - Recurso não encontrado |
| 409 | Conflict - Conflito (ex: email já existe) |
| 422 | Validation Error - Erro de validação |
| 500 | Internal Server Error - Erro interno |

**Formato de Erro:**
```json
{
  "status": "error",
  "error": "Error message"
}
```

---

## 📊 Rate Limiting

Atualmente não há rate limiting implementado. Em produção, será adicionado rate limiting de:
- 100 requisições por minuto por IP
- 1000 requisições por hora por usuário autenticado

---

## 🔒 Segurança

- Todas as senhas são hasheadas com bcrypt (salt rounds: 10)
- Tokens JWT expiram em 7 dias
- CORS configurado
- Headers de segurança com Helmet
- Validação de entrada com Zod

---

Última atualização: 2026-01-18
