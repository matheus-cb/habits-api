# Node 22: é o que o CI usa e o que `engines` permite. Antes era node:18-alpine —
# EOL, e diferente da versão em que os testes rodam.
FROM node:22-alpine AS builder

WORKDIR /app

# `openssl` é exigência do Prisma, não conveniência: sem ele o `prisma generate`
# não encontra a biblioteca do engine que `binaryTargets` pede.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ── Produção ────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev

# O cliente vem do builder em vez de ser regerado: regerar aqui roda um segundo
# `prisma generate` que pode escolher engine diferente do que foi testado no
# build. Copiar garante que o binário que subiu é o binário que foi construído.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Roda como usuário sem privilégio. A imagem `node` já traz o usuário `node`.
RUN chown -R node:node /app
USER node

EXPOSE 3333

# `start-period` generoso porque o entrypoint aplica migrações antes de subir o
# servidor, e a primeira execução em banco vazio leva alguns segundos. Com os 5s
# anteriores o container era marcado unhealthy antes de terminar de subir.
HEALTHCHECK --interval=5s --timeout=3s --start-period=40s --retries=10 \
  CMD node -e "require('http').get('http://127.0.0.1:3333/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
