# Subir para produção

O que está pronto, o que falta, e por que o que falta é seu e não meu.

## O estado hoje

O **código** está publicado: `master`/`main` dos três repositórios no GitHub, com CI
verde. O que não existe é **hospedagem** —
`habits-api-production.up.railway.app/health` responde 404, e não há nada rodando em
nenhum lugar.

## Por que eu não executo o deploy

`railway login` é autenticação numa conta sua num serviço terceiro. Não é relutância
nem falta de permissão do repositório: é que a credencial é sua, o custo da conta é
seu, e um serviço publicado na internet com o seu nome é uma decisão que precisa
passar por você.

O que eu preparei tira todo o resto do caminho. Sobram três comandos.

## Por que Docker e não o builder automático

`railway.json` manda construir a partir do **`Dockerfile`**, e essa é a decisão que
mais importa aqui.

O builder automático (nixpacks) inferiria o build a partir do `package.json` e
produziria uma imagem **que nunca foi testada**. O `Dockerfile` deste repositório é
exercitado pela Camada 3 em cada execução do CI: ela sobe a imagem e bate nela com 63
asserções por HTTP.

E ele já produziu container em loop de reinício sem nada perceber — seis defeitos
empilhados, todos invisíveis para as Camadas 1 e 2, que carregam a aplicação em
processo. Produção rodando o mesmo artefato que o smoke valida é a única forma de
esse histórico não se repetir onde ninguém está olhando.

`healthcheckPath: /health` pelo mesmo motivo: aquela rota consulta o banco de verdade
e devolve **503** quando não alcança — ela já respondeu 200 com zero tabelas, e foi
corrigida. Um healthcheck que só verifica se a porta abre aceitaria de volta
exatamente o estado que ela existe para recusar.

## Os três comandos

```bash
npm install -g @railway/cli
railway login
railway init          # ou `railway link` se o projeto já existir
```

Depois, no painel do Railway: **New → Database → PostgreSQL**. Ele injeta
`DATABASE_URL` sozinho.

```bash
railway up
```

O `docker-entrypoint.sh` roda `prisma migrate deploy` no boot, então as tabelas, a
role somente-leitura e as políticas de RLS nascem na primeira subida.

## As variáveis, e o que acontece se cada uma faltar

Obrigatórias:

| variável | se faltar |
|---|---|
| `DATABASE_URL` | **não sobe** — o Zod valida na inicialização (INV-09) |
| `JWT_SECRET` | **não sobe** — mínimo de 32 caracteres, e o default antigo tinha 25 |
| `CORS_ORIGIN` | o navegador bloqueia o dashboard; ponha a URL dele, sem barra final |

Recomendadas:

| variável | se faltar |
|---|---|
| `DATABASE_URL_READONLY` | a primitiva `query` do MCP **não é registrada** — sintoma `Tool query not found`, não erro de conexão |
| `ANTHROPIC_API_KEY` | o chat recusa com o motivo e o resumo de aderência usa o gerador determinístico. **O resto do app funciona igual** (INV-15) |
| `NODE_ENV=production` | mensagem de erro desconhecido vazaria detalhe (INV-12) |

`CLAUDE_CLI_PATH` **não vai** para produção: o motor CLI precisa do `claude`
instalado e autenticado na máquina, e a credencial vive no keychain de quem instalou.
Em produção o chat usa a chave da API ou recusa.

A `DATABASE_URL_READONLY` de produção precisa da senha real da role
`habits_readonly` — a migração a cria com senha de desenvolvimento, e trocá-la é um
passo manual:

```sql
ALTER ROLE habits_readonly PASSWORD 'algo-forte-aqui';
```

## Antes de expor: uma coisa que não é opcional

**`POST /auth/register` é aberto.** Qualquer pessoa com a URL cria conta, e toda
mensagem do chat consome a `ANTHROPIC_API_KEY` do servidor.

Local isso é inofensivo. Exposto, é a primeira coisa a fechar — antes de qualquer
outra, porque o acesso é de quem souber o endereço e a conta é de quem hospeda. Ver
`docs/PENDENCIAS.md`.

## O dashboard

É um SPA de Vite: build estático, sem servidor. `vercel.json` está no repositório do
dashboard, com o rewrite que faz rota de cliente funcionar em recarga direta — sem
ele, abrir `/insights` diretamente dá 404 porque o arquivo não existe no disco.

Uma variável: `VITE_API_URL` apontando para a URL da API + `/api/v1`. Ela é
**embutida no build**, não lida em tempo de execução: trocar exige rebuild, e é por
isso que ela não pode ser configurada no painel depois.

## O que fica de fora, e vale saber

O **mobile** não tem deploy preparado. Expo publica por `eas build`, que exige conta
Expo e credencial de assinatura de app — mais uma decisão sua, e sem relação com os
outros dois.
