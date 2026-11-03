# Melhorias de organização e composição do APMail

Objetivo: implementar o pedido de 03/11/2026 preservando a arquitetura React/Vite, Fastify, Kysely e PostgreSQL existente. Entregar em main com commit e push; aplicar migrations aditivas autorizadas, sem deploy no Dokploy.

Decisões: favoritos são atalhos pessoais para pastas por caixa, como no Outlook. Arrastar pasta reordena somente irmãos; alterar hierarquia exige menu explícito. Ordem de caixas e pastas e favoritos pertencem ao usuário/empresa e persistem no banco. Posição do compositor e largura da navegação são preferências locais por usuário, limitadas à área visível. Importação deve respeitar a ordem disponível no arquivo ou ordenar alfabeticamente, com mensagens lidas por padrão, sem alterar mensagens antigas indiscriminadamente.

- [x] Compositor e contatos: arraste com posição persistente, teclado e limites da tela; Para/Cc/Cco abrem pesquisa e seleção de endereços, cadastro/associação quando permitido; testes de interação.
- [x] Importação: opção de ordem original/alfabética, captura de metadados de pastas, importações novas lidas por padrão; migration e testes reais de banco/parser.
- [x] Hierarquia: mover pasta pelo menu, validar ciclos, conflitos, permissões, pastas especiais e atualização dos descendentes; suportar pastas locais e IMAP pelo pipeline existente.
- [x] Navegação: preferências pessoais no banco; reordenação de caixas e irmãos por arraste com feedback e alternativa por teclado; favoritos por caixa; mover mensagens da lista e detalhe por arraste com permissões existentes e feedback.
- [x] Verificar largura persistente da navegação, lint, typecheck, testes, build, migrations e acesso negado; executar localmente e revisar desktop 1440×900, tablet 768×1024 e mobile 390×844, claro/escuro.
- [x] Revisar diff e riscos, corrigir achados, aplicar migration no alvo conferido, commit e push; sem envio de e-mail real ou deploy.

Riscos de revisão: arraste de pasta nunca muda pai; destinos de outra caixa ou sem acesso são rejeitados; mensagens selecionadas movem apenas o escopo anunciado; posição salva continua acessível após redimensionar; importação original não promete metadados inexistentes; falhas assíncronas preservam dados e permitem repetir.
