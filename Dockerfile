FROM node:22.23.2-bookworm-slim AS dependencies

WORKDIR /app

# Garante build reprodutível de dependências nativas como better-sqlite3
# mesmo quando não houver binário pré-compilado para a plataforma.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --omit=optional \
    && npm cache clean --force

FROM node:22.23.2-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/uploads /app/data/branding /app/data/print-jobs \
    && chown -R node:node /app

USER node

EXPOSE 3080

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server-main.js"]
