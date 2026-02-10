# Guia de Início Rápido

Comece a usar a Habits API em minutos!

## 🚀 Setup Rápido

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Banco de Dados

Opção A - Usar Docker (Recomendado):
```bash
docker-compose up -d postgres
```

Opção B - PostgreSQL Local:
- Certifique-se de ter PostgreSQL instalado
- Crie um banco chamado `habits`
- Ajuste a `DATABASE_URL` no arquivo `.env`

### 3. Executar Migrações

```bash
npx prisma migrate dev
```

### 4. (Opcional) Popular Banco com Dados de Teste

```bash
npm run prisma:seed
```

Isso criará um usuário demo:
- Email: `demo@example.com`
- Senha: `demo123`

### 5. Iniciar Servidor

```bash
npm run dev
```

A API estará rodando em: `http://localhost:3333`

---

## 📚 Explorando a API

### Documentação Interativa (Swagger)

Acesse: `http://localhost:3333/api-docs`

### Testar Endpoints

#### 1. Registrar Usuário

```bash
curl -X POST http://localhost:3333/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Seu Nome",
    "email": "seu@email.com",
    "password": "senha123"
  }'
```

#### 2. Fazer Login

```bash
curl -X POST http://localhost:3333/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seu@email.com",
    "password": "senha123"
  }'
```

**Copie o `accessToken` retornado!**

#### 3. Criar um Hábito

```bash
curl -X POST http://localhost:3333/api/v1/habits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -d '{
    "title": "Exercícios",
    "description": "30 minutos de exercícios diários"
  }'
```

#### 4. Listar Hábitos

```bash
curl http://localhost:3333/api/v1/habits \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

#### 5. Marcar Check-in

```bash
curl -X POST http://localhost:3333/api/v1/habits/HABIT_ID/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -d '{}'
```

#### 6. Ver Estatísticas

```bash
curl http://localhost:3333/api/v1/habits/HABIT_ID/stats \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

---

## 🧪 Executar Testes

```bash
# Todos os testes
npm test

# Com coverage
npm run test:coverage
```

---

## 🐳 Executar com Docker

### Iniciar tudo com Docker Compose

```bash
# Iniciar todos os serviços
docker-compose up -d

# Ver logs
docker-compose logs -f api

# Executar migrações
docker-compose exec api npx prisma migrate deploy

# Parar serviços
docker-compose down
```

---

## 🛠️ Scripts Úteis

```bash
# Desenvolvimento
npm run dev                # Inicia servidor em modo dev (watch)
npm run build              # Compila TypeScript
npm start                  # Inicia servidor em produção

# Prisma
npm run prisma:generate    # Gera Prisma Client
npm run prisma:migrate     # Cria e aplica migrations
npm run prisma:studio      # Abre interface visual do banco
npm run prisma:seed        # Popula banco com dados de teste

# Qualidade de Código
npm run lint               # Verifica problemas
npm run lint:fix           # Corrige problemas automaticamente
npm run format             # Formata código com Prettier

# Testes
npm test                   # Executa testes
npm run test:watch         # Testes em modo watch
npm run test:coverage      # Testes com cobertura
```

---

## 📁 Usando Insomnia/Postman

1. Importe o arquivo `insomnia-collection.json`
2. Configure a variável `base_url` (padrão: `http://localhost:3333/api/v1`)
3. Faça login e copie o token
4. Configure a variável `token` com o token obtido
5. Teste os endpoints!

---

## 🔧 Configuração de Ambiente

Variáveis necessárias no `.env`:

```env
NODE_ENV=development
PORT=3333
DATABASE_URL="postgresql://user:password@localhost:5432/habits?schema=public"
JWT_SECRET=seu-secret-super-seguro-com-minimo-32-caracteres
JWT_EXPIRES_IN=7d
CORS_ORIGIN=*
LOG_LEVEL=debug
```

---

## ✅ Checklist de Verificação

- [ ] Node.js 18+ instalado
- [ ] PostgreSQL rodando (local ou Docker)
- [ ] Dependências instaladas (`npm install`)
- [ ] Arquivo `.env` configurado
- [ ] Migrations executadas (`npx prisma migrate dev`)
- [ ] Servidor iniciado (`npm run dev`)
- [ ] Swagger acessível em `/api-docs`
- [ ] Health check retornando 200 em `/health`

---

## 🆘 Problemas Comuns

### Erro ao conectar no banco

```
Error: P1001: Can't reach database server
```

**Solução:**
- Verifique se PostgreSQL está rodando
- Confirme a `DATABASE_URL` no `.env`
- Se usando Docker: `docker-compose up -d postgres`

### Erro de JWT_SECRET

```
Invalid environment variables: JWT_SECRET must be at least 32 characters
```

**Solução:**
- Gere um secret seguro: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Atualize `JWT_SECRET` no `.env`

### Porta já em uso

```
Error: listen EADDRINUSE: address already in use :::3333
```

**Solução:**
- Mude o `PORT` no `.env`
- Ou mate o processo: `npx kill-port 3333`

---

## 📖 Próximos Passos

1. Explore a [Documentação da API](./API.md)
2. Entenda a [Arquitetura](./ARQUITETURA.md)
3. Veja o [Planejamento](./PLANEJAMENTO.md)
4. Adicione suas próprias features!

---

**Dúvidas?** Abra uma issue no GitHub!
