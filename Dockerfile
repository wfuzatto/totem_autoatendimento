FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --omit=optional \
    && npm cache clean --force

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/uploads /app/data/branding /app/data/print-jobs \
    && chown -R node:node /app

USER node

EXPOSE 3080

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server-main.js"]
