# APMail

Gestão de e-mails compartilhados do Grupo AP. Aplicação própria com React, Fastify, PostgreSQL, Redis/BullMQ e integração IMAP/POP3/SMTP.

[Recuperação automática das caixas](docs/RECUPERACAO-DE-CAIXAS.md): reconexão persistente,
espera progressiva, retomada da sincronização e distinção entre queda temporária,
senha inválida e falha TLS. Migration aditiva `0057`; publicar API/worker/web juntos.

[Proteção de anexos e ClamAV](docs/ANTIVIRUS-CLAMAV.md): análise assíncrona, quarentena,
bloqueios de download/prévia/envio e central administrativa. Migration aditiva `0056`;
API/worker precisam alcançar o ClamD privado na `dokploy-network`. Arquivos antigos
exigem backfill controlado; limite atual do scanner compartilhado: 25 MiB.

[Google Meet, horários e pop-ups de lembretes](docs/GOOGLE-AGENDA-MEET-POPUPS.md): conexão OAuth em Configurações → Integrações, API oficial do Meet, consulta opcional da Google Agenda, convite remodelado e antecedência de pop-up por evento. Ativação básica descrita no [guia Word](docs/GUIA-INTEGRACAO-GOOGLE.docx).

[Central de relatórios do Google Meet](docs/GOOGLE-MEET-RELATORIOS.md): sincronização em segundo plano, participantes/sessões, gravações, transcrições, notas, consentimento, retenção e exportações PDF/CSV. Migrations aditivas `0043`–`0045`; as credenciais Google também devem ser disponibilizadas ao worker. O documento detalha os serviços opcionais e a configuração no Google Cloud.

[Compositor, calendário e lembretes](docs/COMPOSITOR-CALENDARIO-LEMBRETES.md): ribbon de composição, prioridade, calendário pessoal com recorrências/exceções e convites ICS reais, lembretes persistentes processados pelo worker. Migrations `0035`–`0038`; atualizar API, worker e web juntos. Sem sincronização externa de calendário.

[Formatação pessoal, assinatura editável e Enviados](docs/COMPOSICAO-E-ENVIADOS.md): preferências por usuário e caixa, assinatura dentro do editor e visualização individual dos envios. Migration aditiva `0051`; atualizar API, worker e web juntos.

[Contatos inteligentes e confirmação de leitura](docs/CONTATOS-MDN.md): resolução em lote de múltiplos endereços, criação/vinculação pelo leitor e sugestão somente após envio SMTP; solicitação e resposta MDN RFC 8098 com consentimento, correlação idempotente e preferência persistente. Migrations `0032`–`0034`; atualizar API, worker e web juntos.

[Regras, destinatários e recorrência](docs/REGRAS-DESTINATARIOS-RECORRENCIA.md): correção do teste de regras e do cache de etiquetas; ações pessoais/compartilhadas, aplicação a todo o histórico, autocomplete por endereço e agendamentos recorrentes persistentes. Migrations `0030`–`0031`; API e worker aplicam migrations pendentes automaticamente na inicialização de produção.

[POP3, arquivos locais e backups](docs/EMAILS-POP3-IMPORTACAO-BACKUP.md): recebimento POP3 contínuo, caixas locais, importação PST/OST/MBOX/EML/EMLX/ZIP com cotas e checkpoint, backup PST nativo/MBOX/ZIP EML e correção da busca global. Migrations `0024`–`0029`; API/web/worker juntos, commit/deploy pelo usuário. Envio em blocos de 4 MiB retomáveis, medição das mensagens extraídas e consumo efetivamente adicionado. Distribuição de armazenamento acessível pela listagem/importação; exclusão definitiva de caixas com backup e duas confirmações; remoção de usuários da empresa. PST é gerado em segundo plano com pastas/anexos, retomada e download por 24 horas; OST não é exportado.

Listas operacionais de e-mails usam o formato de conversas e busca no topo; são a exceção ao padrão de filtros por coluna das demais listagens.

[Navegação dos e-mails](docs/NAVEGACAO-EMAIL.md): pastas expansíveis, menu com largura ajustável por arraste e rolagem independente de menu, lista e leitura.

[Contatos Outlook, etiquetas e busca global](docs/CONTATOS-BUSCA-GLOBAL.md): agendas globais/individuais por usuário definidas para novos cadastros pelo admin, sem conversão retroativa; autoria/versão, apelido privado, Empresa/Cargo em texto com autocomplete e endereços próprios opcionais. CSV/VCF com prévia/validação/retomada; validação de e-mail/telefone e nomes globais repetidos bloqueados. Etiquetas globais primeiro e disponibilidade por caixa; regras pessoais só com pessoais, caixa só com globais. Filtros de coluna, ordenação, Colunas/paginação como padrão das listagens. Entrega local de 07/10/2026, migration `0023`; commit e deploy pelo usuário.

Funcionalidades implementadas: múltiplas empresas, caixas compartilhadas IMAP/SMTP, permissões por papel e pasta, leitura segura de HTML e anexos, composição/resposta/encaminhamento, assinaturas, agendamento com Desfazer, etiquetas pessoais, regras, filas de atendimento, atribuição, SLA, notas/menções, dashboard, auditoria e chat em tempo real. Temas claro/escuro, interface responsiva e atalhos de teclado.

As fases concluídas, checks e pendências de publicação estão em [PROGRESSO](docs/PROGRESSO.md). Domínio/HTTPS e SMTP externo dependem da configuração de cada instalação.

Evolução implementada: [especificação e plano](docs/SPEC-EVOLUCAO-APMAIL.md), com editor completo de HTML, assinatura com imagens incorporadas por CID, dashboard pessoal/geral por papel, teste IMAP/SMTP antes de salvar caixas, navegação sem recargas, comparação de regras normalizada, classificação opcional do histórico, contatos por empresa, Supervisor com capacidades explícitas e `/superadmin` com seleção da empresa antes de cadastrar/editar usuários e caixas, gestão exclusiva da plataforma e armazenamento por empresa/caixa.

Instalação APTech atual: **https://app.apmail.com.br**. Domínio/APP_URL, HTTPS, SMTP global e backup diário conferidos em 05/10/2026; cadastro público desativado. Após a limpeza de produção autorizada, existe somente o superadmin, sem empresas/caixas/mensagens. O painel `/superadmin` exige concessão global independente do papel na empresa. As novas métricas e o dashboard estão implementados localmente e dependem do commit/deploy pelo usuário. Use contas distintas para plataforma e operação de e-mails. Consulte [DEPLOY](docs/DEPLOY.md) para bootstrap, atualização e recuperação. Credenciais não são versionadas.

Armazenamento e dashboard: [plano entregue](docs/PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md) e [operação/coleta](docs/OPERACAO-ARMAZENAMENTO.md). Medição lógica versionada, arquivos conferidos e deduplicados, compartilhamento/retenção, reconciliação, histórico e integridade por empresa/caixa. Banco físico e infraestrutura compartilhada ficam separados. Sem planos comerciais atribuídos. Limites de armazenamento/caixas configurados pelo superadmin e bloqueios com checkpoint estão descritos em [cotas](docs/COTAS-ARMAZENAMENTO.md). Fontes opcionais do host precisam ser configuradas no deploy.

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

Verificação: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. Os testes de reconstrução PST/OST incluídos em `pnpm test` requerem `python3` no PATH, sem pypff para os casos unitários; leitura de arquivos reais requer pypff no worker. `pnpm db:reset` recria apenas o banco exclusivo de desenvolvimento; nunca execute contra dados reais.

No servidor compartilhado, portas da infra podem ser alteradas pelas variáveis DEV_* descritas em [DECISOES](docs/DECISOES.md). Não reutilize Redis nem bancos de outros projetos para os testes.

Consulte [arquitetura](docs/ARQUITETURA.md), [design system](docs/design-system.md) e [publicação](docs/DEPLOY.md).

Os envios SMTP e os testes de conexão anunciam o hostname público de `APP_URL` no EHLO/HELO. Para escolher uma identificação diferente, configure `SMTP_EHLO_NAME` na API e no worker, sem protocolo ou porta. A correção evita o fallback `[127.0.0.1]` em contêineres; consulte [SMTP e HostGator](docs/SMTP-HOSTGATOR.md).

O superadmin pode definir quantidade de caixas e capacidade por empresa; proprietários e administradores distribuem a cota entre caixas. A interface apresenta consumo do APMail e do provedor. Importações bloqueadas pela cota preservam um checkpoint e retomam quando houver capacidade. Consulte [cotas de armazenamento](docs/COTAS-ARMAZENAMENTO.md).

O controle individual de filas foi retirado das Preferências; o valor anteriormente salvo é preservado, sem alterar estados ou regras compartilhadas. Em **Preferências → E-mail**, cada usuário escolhe 10, 25, 50 ou 100 e-mails por página (padrão 10) e habilita o **Resumo**, que agrega somente caixas e pastas autorizadas com paginação no servidor. Abrir uma conversa pelo Resumo mantém a caixa de origem para respostas e outras ações.

Tarefas reutilizam a central de lembretes e podem ser vinculadas às conversas. Administradores atribuem tarefas a membros ativos da mesma empresa; o responsável precisa ter acesso ao e-mail vinculado. Tarefas pendentes ou notificadas impedem concluir o atendimento, inclusive no banco e em ações em lote. Concluídas ou dispensadas são terminais, seguindo os estados dos lembretes existentes. As migrations aditivas `0058`–`0060` incluem preferências, vínculo das tarefas e texto incompleto de destinatários em rascunhos.

A ação **Imprimir** gera PDF da conversa inteira visível ao usuário, com prévia, download, logo e metadados. A prévia usa PDF.js dentro da aplicação; **Imprimir PDF** abre a impressão nativa do navegador com todas as páginas. Preserva a formatação básica e tabelas; imagens são identificadas por descrição, sem buscar imagens externas. A imagem Docker da API instala fontes Unicode para o PDF; execução local usa fontes do Windows ou Noto em `/usr/share/fonts/noto`. `APMAIL_PDF_FONT_DIR` permite indicar outra pasta com as famílias Noto.

As barras de ações de e-mail usam ícones com tooltip, foco por teclado e realce na cor primária. No Resumo, ações em lote respeitam as permissões de todas as caixas selecionadas; mover exige um destino por caixa, atribuição oferece responsáveis disponíveis em todas elas e spam reutiliza a confirmação e os filtros existentes. Compartilhar aceita múltiplas conversas; tarefas e impressão permitem escolher a conversa desejada.

As regras permitem respostas automáticas de férias, condições para todas as mensagens, exceções e período de ativação. Consulte [Regras e respostas automáticas](docs/REGRAS-RESPOSTAS-AUTOMATICAS.md) para configuração, permissões e limites do protocolo.

As preferências têm abas **Geral**, **E-mail**, **Notificações**, **Convites** e **2FA**.
Tema e fuso horário aparecem primeiro. A autenticação em dois fatores é opcional,
compatível com Google Authenticator, com QR Code e códigos de recuperação. Exige a
migration aditiva `0048`, preservando `CREDENTIALS_ENCRYPTION_KEY`. Consulte
[Preferências e 2FA](docs/PREFERENCIAS-2FA.md) para ativação, segurança e publicação.

## Perfis de acesso e auditoria

Perfis personalizados em **Equipe e acesso → Perfis de acesso**, com permissões
por tela e ação, exceções em **Permissões por usuário**, e auditoria detalhada com conteúdo restrito, filtros e exportação.
Veja [Perfis e auditoria](docs/PERFIS-E-AUDITORIA.md). Publicação requer as migrations
aditivas **0049**, **0050** e **0053–0055**, executadas pelo migrador habitual.

O cadastro da empresa inclui identificação, CNPJ com consulta automática, endereço
e contato, disponível também no Superadmin. Requer a migration aditiva **0052**.
Veja [Cadastro de empresas](docs/COMPANY-DETAILS.md).
