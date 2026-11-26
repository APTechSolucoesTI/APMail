FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/help-center/package.json apps/help-center/package.json
RUN pnpm --filter @apmail/help-center install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/help-center/ apps/help-center/
RUN pnpm --filter @apmail/help-center validate && pnpm --filter @apmail/help-center build

FROM nginx:stable-alpine
COPY apps/help-center/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/help-center/dist/ /usr/share/nginx/html/
EXPOSE 80
