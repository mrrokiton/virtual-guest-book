# Build from the repository root: docker build -f apps/worker/Dockerfile .
FROM node:24-slim AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /app
COPY . .
# Installing on Linux pulls sharp's prebuilt linux binaries.
RUN pnpm install --frozen-lockfile --prod --filter @vgb/worker...

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/worker
# The same image runs migrations as Fly's release_command (see apps/worker/fly.toml).
CMD ["node_modules/.bin/tsx", "src/index.ts"]
