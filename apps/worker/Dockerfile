# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS pst-build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /pst-source
ADD --checksum=sha256:fd911e60870b24438160be42246bebd4f04a4b3b89e202bb875d7818be7c6eee https://codeload.github.com/ContinuMail/continumail-converter/tar.gz/d94d35e2f43611f0cbc85e1a8686b75249821079 /pst-source/source.tar.gz
RUN tar -xzf source.tar.gz --strip-components=1 && dotnet publish src/Mail2Pst.Cli -c Release -o /pst-out

FROM mcr.microsoft.com/dotnet/runtime:8.0-bookworm-slim AS pst-runtime

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
RUN apt-get update && apt-get install -y --no-install-recommends python3-pypff ca-certificates libicu72 libssl3 libgssapi-krb5-2 libstdc++6 zlib1g && rm -rf /var/lib/apt/lists/*
COPY --from=pst-runtime /usr/share/dotnet /usr/share/dotnet
COPY --from=pst-build --chown=node:node /pst-out /opt/pst
COPY --from=pst-build --chown=node:node /pst-source/source.tar.gz /opt/pst/source.tar.gz
COPY --from=pst-build --chown=node:node /pst-source/LICENSE /opt/pst/LICENSE
ENV PST_EXPORT_COMMAND=/usr/share/dotnet/dotnet PST_EXPORT_DLL=/opt/pst/Mail2Pst.Cli.dll
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node apps/worker/scripts ./scripts
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
CMD ["node", "dist/index.js"]
