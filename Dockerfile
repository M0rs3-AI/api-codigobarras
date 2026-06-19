# ---- Build stage: compila TypeScript ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production stage: solo runtime ----
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY deploy/healthcheck.js ./healthcheck.js

# Imagen base node:alpine ya trae el usuario sin privilegios "node" (uid 1000)
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node healthcheck.js

CMD ["node", "dist/server.js"]
