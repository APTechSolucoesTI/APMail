# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=apmail-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @apmail/worker... build && pnpm deploy --filter @apmail/worker --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3-pypff ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node apps/worker/scripts ./scripts
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
CMD ["node", "dist/index.js"]
