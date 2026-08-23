// Carrega .env.test sobrescrevendo o que já estiver no ambiente.
//
// `override: true` é o ponto: sem ele, o `.env` de desenvolvimento (carregado por
// `config/env.ts` via dotenv) ou um DATABASE_URL exportado no shell venceriam, e
// a suíte apagaria as tabelas do banco errado.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env.test'), override: true });
