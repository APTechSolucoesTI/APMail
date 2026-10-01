# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=apmail-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @apmail/api... build && pnpm deploy --filter @apmail/api --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
