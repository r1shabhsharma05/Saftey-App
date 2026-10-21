# SafeLife AI backend — production container.
# Usage:
#   docker build -t safelife-backend ./Backend
#   docker run -p 5000:5000 --env-file .env safelife-backend
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# server.js requires ./middleware and ./lib at startup — they must ship too
# (previously only server.js + api were copied, so the container crashed
# with MODULE_NOT_FOUND on boot).
COPY server.js api middleware lib ./
# api/ holds the Vercel serverless entry; harmless in the container.
EXPOSE 5000
CMD ["node", "server.js"]
