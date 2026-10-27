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
RUN apk add --no-cache font-noto font-noto-cjk
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN node --input-type=module -e "import PDFDocument from 'pdfkit'; const doc = new PDFDocument(); for (const [path, face] of [['/usr/share/fonts/noto/NotoSans-Regular.ttf'], ['/usr/share/fonts/noto/NotoSans-BoldItalic.ttf'], ['/usr/share/fonts/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKjp-Regular'], ['/usr/share/fonts/noto/NotoSansCJK-Bold.ttc', 'NotoSansCJKjp-Bold'], ['./assets/fonts/NotoEmoji.ttf']]) doc.font(path, face).widthOfString('A'); doc.end(); doc.resume();"
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
