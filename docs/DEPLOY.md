# Guia de Deploy

Como fazer deploy da Habits API em produção.

## 🚀 Opções de Deploy

### 1. Railway (Recomendado - Grátis)

Railway oferece deploy automático e gratuito para projetos pequenos.

#### Passo a Passo

1. **Criar conta no Railway**
   - Acesse: https://railway.app
   - Faça login com GitHub

2. **Fazer deploy**
   ```bash
   # Instalar Railway CLI (opcional)
   npm install -g @railway/cli

   # Login
   railway login

   # Deploy
   railway up
   ```

3. **Configurar variáveis de ambiente**
   - No dashboard do Railway, vá em Variables
   - Adicione as variáveis necessárias:
     - `NODE_ENV=production`
     - `PORT=3333`
     - `DATABASE_URL` (Railway fornece PostgreSQL)
     - `JWT_SECRET` (gere um secret seguro)
     - `CORS_ORIGIN` (URL do seu frontend)

4. **Executar migrations**
   ```bash
   railway run npx prisma migrate deploy
   ```

---

### 2. Render (Grátis)

#### Passo a Passo

1. **Criar conta no Render**
   - Acesse: https://render.com
   - Conecte com GitHub

2. **Criar PostgreSQL Database**
   - New → PostgreSQL
   - Copie a `DATABASE_URL` interna

3. **Criar Web Service**
   - New → Web Service
   - Conecte seu repositório
   - Configure:
     - **Build Command:** `npm install && npx prisma generate && npm run build`
     - **Start Command:** `npx prisma migrate deploy && npm start`

4. **Variáveis de ambiente**
   - Adicione no painel Environment:
     - `NODE_ENV=production`
     - `DATABASE_URL` (do PostgreSQL criado)
     - `JWT_SECRET`
     - `CORS_ORIGIN`

---

### 3. DigitalOcean App Platform

#### Passo a Passo

1. **Criar conta DigitalOcean**
   - https://www.digitalocean.com

2. **Criar Database**
   - Create → Databases → PostgreSQL
   - Copie connection string

3. **Criar App**
   - Create → Apps
   - Conecte GitHub
   - Configure:
     - **Build Command:** `npm install && npx prisma generate && npm run build`
     - **Run Command:** `npx prisma migrate deploy && npm start`

4. **Variáveis de ambiente**
   - Settings → Environment Variables

---

### 4. Heroku (Pago após Nov 2022)

#### Passo a Passo

1. **Instalar Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Login e criar app**
   ```bash
   heroku login
   heroku create habits-api
   ```

3. **Adicionar PostgreSQL**
   ```bash
   heroku addons:create heroku-postgresql:hobby-dev
   ```

4. **Configurar variáveis**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set JWT_SECRET=seu-secret-aqui
   ```

5. **Deploy**
   ```bash
   git push heroku main
   ```

6. **Executar migrations**
   ```bash
   heroku run npx prisma migrate deploy
   ```

---

### 5. VPS (DigitalOcean, AWS EC2, etc.)

Para controle total, use um VPS.

#### Requisitos
- Ubuntu 20.04+
- Node.js 18+
- PostgreSQL
- Nginx
- PM2

#### Setup Básico

1. **Instalar dependências**
   ```bash
   # Atualizar sistema
   sudo apt update && sudo apt upgrade -y

   # Instalar Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs

   # Instalar PostgreSQL
   sudo apt install postgresql postgresql-contrib -y

   # Instalar PM2
   sudo npm install -g pm2

   # Instalar Nginx
   sudo apt install nginx -y
   ```

2. **Configurar PostgreSQL**
   ```bash
   sudo -u postgres psql

   # No prompt do PostgreSQL:
   CREATE DATABASE habits;
   CREATE USER habitsuser WITH PASSWORD 'sua-senha';
   GRANT ALL PRIVILEGES ON DATABASE habits TO habitsuser;
   \q
   ```

3. **Clonar e configurar projeto**
   ```bash
   cd /var/www
   git clone https://github.com/seu-usuario/habits-api.git
   cd habits-api

   # Instalar dependências
   npm ci --only=production

   # Criar .env
   nano .env
   # Configure todas as variáveis

   # Build
   npm run build

   # Executar migrations
   npx prisma migrate deploy
   ```

4. **Configurar PM2**
   ```bash
   # Iniciar aplicação
   pm2 start dist/server.js --name habits-api

   # Configurar para iniciar no boot
   pm2 startup
   pm2 save
   ```

5. **Configurar Nginx**
   ```bash
   sudo nano /etc/nginx/sites-available/habits-api
   ```

   Adicione:
   ```nginx
   server {
       listen 80;
       server_name seu-dominio.com;

       location / {
           proxy_pass http://localhost:3333;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   ```bash
   # Ativar site
   sudo ln -s /etc/nginx/sites-available/habits-api /etc/nginx/sites-enabled/

   # Testar configuração
   sudo nginx -t

   # Reiniciar Nginx
   sudo systemctl restart nginx
   ```

6. **SSL com Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d seu-dominio.com
   ```

---

## 🔐 Variáveis de Ambiente Obrigatórias

```env
NODE_ENV=production
PORT=3333
DATABASE_URL=postgresql://user:password@host:5432/habits
JWT_SECRET=seu-secret-super-seguro-minimo-32-caracteres
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://seu-frontend.com
LOG_LEVEL=info
```

### Gerando JWT_SECRET Seguro

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# OpenSSL
openssl rand -hex 64

# Python
python3 -c "import secrets; print(secrets.token_hex(64))"
```

---

## ✅ Checklist Pré-Deploy

- [ ] Testes passando (`npm test`)
- [ ] Build funcionando (`npm run build`)
- [ ] Variáveis de ambiente configuradas
- [ ] DATABASE_URL correto
- [ ] JWT_SECRET gerado (64+ chars)
- [ ] CORS_ORIGIN definido
- [ ] Migrations prontas
- [ ] .env adicionado ao .gitignore
- [ ] README atualizado com URL de produção

---

## 🔍 Pós-Deploy

### Verificar Health Check
```bash
curl https://sua-api.com/health
```

Deve retornar:
```json
{
  "status": "success",
  "data": {
    "status": "healthy",
    "timestamp": "...",
    "uptime": 123.45
  }
}
```

### Testar Endpoints
```bash
# Register
curl -X POST https://sua-api.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","password":"test123"}'

# Login
curl -X POST https://sua-api.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}'
```

### Monitoramento

**Railway/Render**
- Logs disponíveis no dashboard
- Métricas de uso
- Alertas automáticos

**VPS**
```bash
# Ver logs do PM2
pm2 logs habits-api

# Status
pm2 status

# Monitoramento
pm2 monit
```

---

## 🐛 Troubleshooting

### Erro de conexão com banco
```
Error: P1001: Can't reach database server
```
**Solução:**
- Verifique DATABASE_URL
- Confirme que banco está acessível
- Verifique firewall/security groups

### Migrations falhando
```
Error: Migration failed
```
**Solução:**
```bash
# Resetar migrations (CUIDADO: apaga dados)
npx prisma migrate reset

# Ou aplicar manualmente
npx prisma migrate deploy
```

### Erro de JWT
```
JsonWebTokenError: invalid signature
```
**Solução:**
- Verifique JWT_SECRET
- Não use espaços no secret
- Mínimo 32 caracteres

### Porta já em uso
```
EADDRINUSE: address already in use
```
**Solução:**
```bash
# Encontrar processo
lsof -i :3333

# Matar processo
kill -9 <PID>

# Ou usar PM2
pm2 restart habits-api
```

---

## 📊 Monitoramento Recomendado

### Logs
- **Desenvolvimento:** Console logs
- **Produção:**
  - Sentry (erros)
  - Datadog (métricas)
  - LogDNA (logs)

### Uptime
- UptimeRobot
- Pingdom
- StatusCake

### Performance
- New Relic
- AppDynamics
- Datadog APM

---

## 🔄 CI/CD com GitHub Actions

Crie `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Deploy to Railway
        run: |
          npm install -g @railway/cli
          railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

---

## 📱 Conectar Frontend

No seu app React Native ou web:

```typescript
// config/api.ts
export const API_URL = process.env.REACT_APP_API_URL || 'https://sua-api.com/api/v1';

// services/api.ts
import axios from 'axios';
import { API_URL } from '../config/api';

const api = axios.create({
  baseURL: API_URL,
});

// Adicionar token em todas as requisições
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

---

**Boa sorte com o deploy! 🚀**
