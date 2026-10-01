# APMail

Gestão de e-mails compartilhados do Grupo AP. Aplicação própria com React, Fastify, PostgreSQL, Redis/BullMQ e integração IMAP/SMTP.

Implementação em andamento conforme [PROGRESSO](docs/PROGRESSO.md). Nenhuma fase pendente deve ser tratada como funcionalidade entregue.

## Desenvolvimento

Requer Node 22.12 ou superior, pnpm 12.8.1 e Docker Compose.

1. Copie `.env.example` para `.env`.
2. Gere SESSION_SECRET e CREDENTIALS_ENCRYPTION_KEY separadamente com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Execute `pnpm install`, `pnpm dev:infra`, `pnpm db:migrate` e `pnpm db:types`.
4. Execute `pnpm dev`. A interface abre em localhost:5173; API em localhost:3001; demonstração em `/_dev/ui`.
5. Mailpit: localhost:8025. GreenMail usa contas de teste da configuração Compose.

Verificação: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. `pnpm db:reset` recria apenas o banco exclusivo de desenvolvimento; nunca execute contra dados reais.

No servidor compartilhado, portas da infra podem ser alteradas pelas variáveis DEV_* descritas em [DECISOES](docs/DECISOES.md). Não reutilize Redis nem bancos de outros projetos para os testes.

Consulte [arquitetura](docs/ARQUITETURA.md), [design system](docs/design-system.md) e [publicação](docs/DEPLOY.md).
