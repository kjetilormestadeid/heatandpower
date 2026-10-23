# Bygg frontend (Vite) og kjør Express-backenden i produksjonsmodus.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx (devDependency) kjører serveren direkte fra TypeScript
RUN npm ci --include=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json tsconfig.node.json ./
EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
