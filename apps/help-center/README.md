# Central de Ajuda APMail

Central pública e independente do APMail, preparada para publicação em `https://ajuda.apmail.com.br`.

## Desenvolvimento

Na raiz do monorepo, instale as dependências com Node.js 22.22.2+ e pnpm 12.8.1+:

```powershell
pnpm install
pnpm dev:help
```

O servidor local do app usa a porta padrão do Vite. Para validar conteúdo, tipos e testes:

```powershell
pnpm --filter @apmail/help-center validate
pnpm --filter @apmail/help-center typecheck
pnpm --filter @apmail/help-center test
pnpm --filter @apmail/help-center build
```

O build gera páginas em `apps/help-center/dist`, incluindo uma página HTML por artigo em `/docs/<categoria>/<slug>/`, `robots.txt` e `sitemap.xml`.

## Publicação

Publique o conteúdo de `apps/help-center/dist` como um site estático separado e aponte `ajuda.apmail.com.br` para esse serviço. Não é necessário compartilhar banco, API, sessão ou variáveis secretas do APMail.

No Dokploy, crie uma aplicação separada a partir deste repositório com o contexto na raiz,
Dockerfile `apps/help-center/Dockerfile` e porta interna `80`. Configure o domínio
`ajuda.apmail.com.br` com HTTPS.

No app principal, o botão **Central de ajuda** na barra de utilitários da navegação abre o site em outra aba.

## Conteúdo e imagens

Os artigos ficam em `src/content/<categoria>/<slug>.md`. Cada arquivo declara metadados no frontmatter; o validador verifica campos obrigatórios, relações e referências de imagem.

As imagens em `public/images/screenshots/` são capturas reais da homologação fornecida, recortadas e anonimizadas. Os arquivos brutos não fazem parte da entrega. Não adicionar novos prints reais sem autorização e sem sanitização completa.
