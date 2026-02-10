# Planejamento - Habits API

Cronograma de desenvolvimento de 3 dias para entrega de MVP funcional e demonstrável.

## 🎯 Objetivo

Criar uma API REST completa e funcional para gerenciamento de hábitos, com código limpo, testes, documentação e deploy, pronta para apresentação em portfólio.

## 📅 Cronograma Detalhado

### **Dia 1: Fundação e Autenticação** (6-8 horas)

#### Manhã (3-4h)
- [x] Setup inicial do projeto
  - Estrutura de pastas
  - package.json com dependências
  - TypeScript configurado
  - ESLint + Prettier
  - EditorConfig
  - Git + .gitignore

- [x] Configuração do banco de dados
  - Prisma setup
  - Schema inicial (User)
  - Primeira migration
  - Seed script básico

#### Tarde (3-4h)
- [ ] Sistema de autenticação
  - Controller de autenticação
  - Service de autenticação
  - Hash de senhas (bcrypt)
  - Geração de JWT
  - Endpoints:
    - POST /auth/register
    - POST /auth/login
    - GET /auth/me
  - Middleware de autenticação
  - Validação com Zod

**Entregável Dia 1:** API com autenticação funcional

---

### **Dia 2: Features Principais** (6-8 horas)

#### Manhã (3-4h)
- [ ] CRUD de Hábitos
  - Schema Habit no Prisma
  - Migration de Habits
  - Controller de hábitos
  - Service de hábitos
  - Repository de hábitos
  - Endpoints:
    - GET /habits (listar)
    - POST /habits (criar)
    - GET /habits/:id (buscar)
    - PUT /habits/:id (atualizar)
    - DELETE /habits/:id (deletar)
  - Validações com Zod

#### Tarde (3-4h)
- [ ] Sistema de Check-ins
  - Schema Checkin no Prisma
  - Migration de Checkins
  - Relacionamentos (User -> Habit -> Checkin)
  - Controller de check-ins
  - Service de check-ins
  - Endpoints:
    - POST /habits/:id/checkin
    - GET /habits/:id/checkins
    - GET /habits/:id/stats
  - Lógica de cálculo de streaks
  - Validação de check-in duplicado no mesmo dia

**Entregável Dia 2:** API com todas features principais funcionando

---

### **Dia 3: Qualidade e Entrega** (6-8 horas)

#### Manhã (3-4h)
- [ ] Documentação e Testes
  - Swagger/OpenAPI completo
  - Configuração de testes (Jest)
  - Testes de autenticação
  - Testes de hábitos
  - Testes de check-ins
  - Tratamento de erros global melhorado
  - Logging estruturado

#### Tarde (3-4h)
- [ ] Docker e Deploy
  - Dockerfile otimizado
  - docker-compose.yml
  - Scripts de inicialização
  - README completo
  - Deploy no Render/Railway
  - Variáveis de ambiente em produção
  - Testes finais
  - Collection do Postman/Insomnia

**Entregável Dia 3:** API completa, documentada, testada e deployada

---

## 🎯 Features do MVP

### ✅ Obrigatórias (Essenciais)
- [x] Autenticação JWT
- [ ] CRUD de hábitos
- [ ] Sistema de check-ins
- [ ] Cálculo de streaks
- [ ] Documentação Swagger
- [ ] Docker
- [ ] Deploy online

### 🔄 Opcionais (Se houver tempo)
- [ ] Rate limiting
- [ ] Refresh tokens
- [ ] Categorias de hábitos
- [ ] Sistema de notificações
- [ ] Estatísticas avançadas
- [ ] Testes E2E completos

---

## 📊 Métricas de Sucesso

Ao final dos 3 dias, a API deve ter:

- ✅ 10+ endpoints funcionais
- ✅ Autenticação segura com JWT
- ✅ Banco de dados relacional configurado
- ✅ Documentação Swagger interativa
- ✅ Mínimo 10 testes automatizados
- ✅ Dockerizada e rodando em container
- ✅ Deployada e acessível online
- ✅ README completo com instruções
- ✅ Código limpo e organizado
- ✅ Collection Postman/Insomnia

---

## 🛠️ Stack Tecnológica

### Core
- Node.js 18+
- TypeScript 5+
- Express 4+

### Banco de Dados
- PostgreSQL 15+
- Prisma ORM 5+

### Autenticação
- jsonwebtoken
- bcryptjs

### Validação
- Zod

### Documentação
- Swagger UI Express
- OpenAPI 3.0

### Testes
- Jest
- Supertest

### DevOps
- Docker
- Docker Compose

### Qualidade de Código
- ESLint
- Prettier
- TypeScript Strict Mode

---

## 🚧 Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Problemas com Docker no Windows | Média | Alto | Usar Railway/Render que abstrai Docker |
| Atraso na implementação | Média | Médio | Priorizar MVP, deixar features opcionais |
| Bugs em produção | Baixa | Alto | Testes automatizados obrigatórios |
| Problemas de deploy | Baixa | Médio | Usar plataformas com deploy simples |

---

## 📝 Checklist Final

Antes de considerar o projeto concluído:

- [ ] Código commitado no GitHub
- [ ] README completo e claro
- [ ] Swagger funcionando
- [ ] Testes passando
- [ ] Docker Compose funcional
- [ ] Deploy online ativo
- [ ] Collection Postman exportada
- [ ] Variáveis de ambiente documentadas
- [ ] Sem credenciais expostas
- [ ] Logs estruturados
- [ ] Tratamento de erros adequado

---

## 🎓 Aprendizados Esperados

Este projeto demonstra:

- ✅ Arquitetura limpa e escalável
- ✅ Boas práticas de TypeScript
- ✅ Segurança em APIs (JWT, hashing)
- ✅ Testes automatizados
- ✅ Documentação de API
- ✅ Containerização
- ✅ CI/CD básico
- ✅ Deploy em produção

---

Última atualização: 2026-01-18
