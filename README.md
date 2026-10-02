# APMail

Gestão de e-mails compartilhados do Grupo AP. Aplicação própria com React, Fastify, PostgreSQL, Redis/BullMQ e integração IMAP/SMTP.

Funcionalidades implementadas: múltiplas empresas, caixas compartilhadas IMAP/SMTP, permissões por papel e pasta, leitura segura de HTML e anexos, composição/resposta/encaminhamento, assinaturas, agendamento com Desfazer, etiquetas pessoais, regras, filas de atendimento, atribuição, SLA, notas/menções, dashboard, auditoria e chat em tempo real. Temas claro/escuro, interface responsiva e atalhos de teclado.

As fases concluídas, checks e pendências de publicação estão em [PROGRESSO](docs/PROGRESSO.md). Domínio/HTTPS e SMTP externo dependem da configuração de cada instalação.

Evolução implementada: [especificação e plano](docs/SPEC-EVOLUCAO-APMAIL.md), com editor completo de HTML, upload de assinatura, navegação sem recargas, comparação de regras normalizada, classificação opcional do histórico, contatos por empresa, Supervisor com capacidades explícitas e `/superadmin`.

Instalação APTech: **https://apmail.aptechinfo.com.br:75**. Domínio HTTPS, SMTP global e caixa real já configurados; cadastro público desativado e backup diário ativo. O painel `/superadmin` exige concessão global independente do papel na empresa. Consulte [DEPLOY](docs/DEPLOY.md) para bootstrap, atualização e recuperação. Credenciais não são versionadas.

## Docker e Dokploy

1. Copie `.env.example` para `.env`; preencha senha do Postgres, duas chaves de 32 bytes, URL e SMTP do sistema.
2. Para revisão local, copie `docker-compose.override.example.yml` para `docker-compose.override.yml`.
3. Execute `docker compose up -d --build --wait --wait-timeout 180` e abra `http://localhost:8080`.
4. Crie proprietário/empresa por `/signup`; depois desative `ALLOW_PUBLIC_SIGNUP` e recrie a API.

O Compose principal não publica portas e pode ser usado no Dokploy, branch `main`, com domínio apontando ao serviço `web`, porta 80. Consulte [DEPLOY](docs/DEPLOY.md) para ambiente, HTTPS, convites, backups, restauração e atualização. PostgreSQL, Redis e anexos têm volumes persistentes; `docker compose down` sem `-v` preserva dados.

## Desenvolvimento

Requer Node 22.22.2 ou superior, pnpm 12.8.1 e Docker Compose.

1. Copie `.env.example` para `.env` e ajuste `APP_URL=http://localhost:5173` para desenvolvimento.
2. Gere SESSION_SECRET e CREDENTIALS_ENCRYPTION_KEY separadamente com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Execute `pnpm install`, `pnpm dev:infra`, `pnpm db:migrate` e `pnpm db:types`.
4. Execute `pnpm seed:dev` para preparar Empresa Demo e quatro usuários (senha exclusiva de desenvolvimento: `Senha@123`). Execute `pnpm dev`. A interface abre em localhost:5173; API em localhost:3001; demonstração em `/_dev/ui`.
5. Mailpit: localhost:8025. GreenMail usa contas de teste da configuração Compose.

Verificação: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. `pnpm db:reset` recria apenas o banco exclusivo de desenvolvimento; nunca execute contra dados reais.

No servidor compartilhado, portas da infra podem ser alteradas pelas variáveis DEV_* descritas em [DECISOES](docs/DECISOES.md). Não reutilize Redis nem bancos de outros projetos para os testes.

Consulte [arquitetura](docs/ARQUITETURA.md), [design system](docs/design-system.md) e [publicação](docs/DEPLOY.md).
