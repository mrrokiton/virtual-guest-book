# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS base
RUN npm install -g pnpm@12.6.0
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @vgb/web...
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @vgb/web build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
