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
ARG PUBLIC_BASE_PATH=/totem
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
WORKDIR /app

# Tudo que o backend precisa fica dentro da imagem. Tesseract/Poppler sustentam
# a validação documental e a conversão de PDF antes de enviar a face do
# documento ao serviço face_scanner; o host não precisa instalar esses pacotes.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates \
       tesseract-ocr \
       tesseract-ocr-por \
       tesseract-ocr-eng \
       poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# A UI Docker é publicada sob /totem. O script altera apenas artefatos públicos
# (HTML/JS/CSS/manifest), preservando as rotas internas nativas /api/*.
RUN node src/prepare-public-base-path.js /app/public "$PUBLIC_BASE_PATH" \
    && mkdir -p /app/data/uploads /app/data/branding /app/data/print-jobs \
    && chown -R node:node /app

USER node

EXPOSE 3080

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server-main.js"]
