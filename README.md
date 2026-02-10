# Habits API 🎯

API REST completa para gerenciamento de hábitos com sistema de gamificação, desenvolvida com Node.js, TypeScript e arquitetura escalável.

## 📋 Sobre o Projeto

API RESTful robusta para aplicativo de produtividade focado em tracking de hábitos. Inclui autenticação JWT, sistema de check-ins, estatísticas de progresso e documentação completa com Swagger.

## ✨ Features

- ✅ Autenticação e autorização com JWT
- ✅ CRUD completo de hábitos
- ✅ Sistema de check-ins diários
- ✅ Cálculo de streaks (sequências)
- ✅ Estatísticas e progresso
- ✅ Documentação interativa com Swagger
- ✅ Testes automatizados
- ✅ Containerização com Docker
- ✅ Validação de dados robusta
- ✅ Tratamento de erros global

## 🚀 Tecnologias

- **Node.js** - Runtime JavaScript
- **TypeScript** - Tipagem estática
- **Express** - Framework web
- **Prisma** - ORM moderno
- **PostgreSQL** - Banco de dados
- **JWT** - Autenticação
- **Zod** - Validação de schemas
- **Swagger** - Documentação de API
- **Jest** - Testes automatizados
- **Docker** - Containerização

## 📁 Estrutura do Projeto

```
habits-api/
├── src/
│   ├── config/          # Configurações da aplicação
│   ├── controllers/     # Controladores das rotas
│   ├── middlewares/     # Middlewares customizados
│   ├── routes/          # Definição de rotas
│   ├── services/        # Lógica de negócio
│   ├── repositories/    # Camada de acesso a dados
│   ├── schemas/         # Schemas de validação (Zod)
│   ├── types/           # Tipos TypeScript
│   ├── utils/           # Funções utilitárias
│   └── app.ts           # Configuração do Express
│   └── server.ts        # Entrada da aplicação
├── prisma/
│   ├── schema.prisma    # Schema do banco de dados
│   └── migrations/      # Migrações do banco
├── tests/               # Testes automatizados
├── docs/                # Documentação adicional
├── .env.example         # Exemplo de variáveis de ambiente
├── docker-compose.yml   # Configuração Docker
├── Dockerfile           # Imagem Docker da aplicação
└── package.json         # Dependências do projeto
```

## 🔧 Instalação e Configuração

### Pré-requisitos

- Node.js 18+
- Docker e Docker Compose (opcional)
- PostgreSQL (se não usar Docker)

### Instalação Local

1. Clone o repositório:
```bash
git clone https://github.com/matheus-cb/habits-api.git
cd habits-api
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Execute as migrações do banco:
```bash
npx prisma migrate dev
```

5. (Opcional) Popule o banco com dados de exemplo:
```bash
npm run seed
```

6. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

A API estará disponível em `http://localhost:3333`

### Usando Docker

1. Inicie os containers:
```bash
docker-compose up -d
```

2. Execute as migrações:
```bash
docker-compose exec api npx prisma migrate deploy
```

A API estará disponível em `http://localhost:3333`

## 📚 Documentação da API

Acesse a documentação interativa Swagger em: `http://localhost:3333/api-docs`

### Endpoints Principais

#### Autenticação
- `POST /auth/register` - Registrar novo usuário
- `POST /auth/login` - Login e obtenção de token JWT
- `GET /auth/me` - Dados do usuário autenticado

#### Hábitos
- `GET /habits` - Listar todos os hábitos do usuário
- `POST /habits` - Criar novo hábito
- `GET /habits/:id` - Buscar hábito específico
- `PUT /habits/:id` - Atualizar hábito
- `DELETE /habits/:id` - Deletar hábito

#### Check-ins
- `POST /habits/:id/checkin` - Marcar hábito como concluído
- `GET /habits/:id/checkins` - Histórico de check-ins
- `GET /habits/:id/stats` - Estatísticas do hábito

## 🧪 Testes

Execute os testes:
```bash
# Todos os testes
npm test

# Testes em modo watch
npm run test:watch

# Cobertura de testes
npm run test:coverage
```

## 🏗️ Arquitetura

O projeto segue princípios de **Clean Architecture** e **SOLID**:

- **Controllers**: Recebem requisições HTTP e delegam para services
- **Services**: Contêm a lógica de negócio
- **Repositories**: Abstraem o acesso ao banco de dados
- **Middlewares**: Tratam autenticação, validação e erros
- **Schemas**: Validam entrada de dados com Zod

Ver mais detalhes em [ARQUITETURA.md](./docs/ARQUITETURA.md)

## 🔐 Segurança

- Senhas hasheadas com bcrypt
- Autenticação via JWT
- Validação de entrada com Zod
- Rate limiting (em produção)
- Sanitização de dados
- Headers de segurança com Helmet

## 🚀 Deploy

### Railway / Render

1. Faça push do código para GitHub
2. Conecte o repositório no Railway/Render
3. Configure as variáveis de ambiente
4. O deploy será automático

### Variáveis de Ambiente Necessárias

```env
NODE_ENV=production
PORT=3333
DATABASE_URL=postgresql://user:password@host:5432/habits
JWT_SECRET=seu-secret-super-seguro
```

## 📝 Scripts Disponíveis

```bash
npm run dev          # Inicia servidor de desenvolvimento
npm run build        # Compila TypeScript para JavaScript
npm start            # Inicia servidor em produção
npm test             # Executa testes
npm run test:watch   # Testes em modo watch
npm run lint         # Verifica problemas de código
npm run format       # Formata código com Prettier
npm run prisma:studio # Interface visual do banco
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues e pull requests.

## 📄 Licença

Este projeto está sob a licença MIT.

## 👨‍💻 Autor

**Matheus Caitano Batista**

- GitHub: [@matheus-cb](https://github.com/matheus-cb)
- LinkedIn: [matheus-caitano-batista-dev](https://www.linkedin.com/in/matheus-caitano-batista-dev/)
- Email: matheuscb@msn.com

---

Desenvolvido com ❤️ como projeto de portfólio
