# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=apmail-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @apmail/web... build

FROM nginx:stable-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 80
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
