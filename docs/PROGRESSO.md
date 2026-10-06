# Progresso do APMail

## Revisão de 06/10/2026 — quota individual e localização das barras (local)

- Identificado no código do ImapFlow 2.2.1 que respostas QUOTA de raízes diferentes sobrescrevem o mesmo recurso. Adaptador preserva cada resposta e seleciona somente a raiz individual; domínio/hospedagem/raiz opaca ou ambígua não viram limite da caixa. Seleção conservadora por convenções de nome e hosts conhecidos, com limitações documentadas; não houve leitura da conta real do provedor nem mudança em produção nesta revisão.
- Nova migration `0019_provider_account_quota.sql` invalida medições antigas, preservando cotas APMail, checkpoint e conteúdo. Próximo ciclo consulta a quota novamente. Falha de consulta também remove valores antigos. Inteiros do protocolo convertidos para bytes com BigInt.
- Duas barras na listagem de Configurações → Caixas de e-mail, com layout próprio em celulares. Tela de e-mails sem painel permanente: somente alertas de 90% ou mais, limite atingido e sincronização pausada. Cadastro com Gmail/Google Workspace, Hotmail/Outlook.com, Outlook/Microsoft 365 e Outro; removidos os presets Zoho.
- Validação: lint, typecheck e build; 67 testes unitários aprovados, incluindo sete regressões de quota com servidor IMAP local real para testar parsing/ordem de raízes e quatro testes da interface. Dois testes de migrations e uma regressão de invalidação/preservação passaram no PostgreSQL de QA. Navegador com fixtures: oito combinações de 1440/900/390/320 px e claro/escuro sem overflow, erros JavaScript ou violações axe WCAG A/AA; avisos, ausência das barras na tela de e-mails e presets conferidos. Relatório ignorado pelo Git: `.data/qa/provider-quota-ui-report.json`.
- Somente implementação local, sem commit, push ou deploy. Orientações em [DEPLOY.md](DEPLOY.md) e [COTAS-ARMAZENAMENTO.md](COTAS-ARMAZENAMENTO.md).

## Entrega de 06/10/2026 — cotas por empresa/caixa e retomada da sincronização (local)

- Superadmin configura limite de caixas e capacidade da empresa, depois de selecionar a empresa. Valores vazios mantêm capacidade ilimitada; zero é um limite válido. Contagem e admissão são protegidas no banco, inclusive em cadastros concorrentes.
- Distribuição automática igual entre caixas não excluídas, com divisão exata em bytes. Proprietário/admin pode distribuir manualmente por percentual ou quantidade/unidade, sem ultrapassar o teto. Após personalizar, uma nova caixa recebe somente o saldo livre; sem saldo, o cadastro exige redistribuição. Excluir uma caixa libera sua alocação, mas conteúdo retido continua consumindo a capacidade da empresa.
- Barras APMail/provedor na caixa, visão agregada em Empresa e configuração no superadmin. Consulta de quota IMAP com atualização periódica; informação indisponível/erro fica explícita. Agregação deduplica a mesma conta/raiz conhecida e informa cobertura parcial, sem presumir quotas entre logins diferentes.
- Bloqueio de crescimento em arquivos, mensagens, rascunhos/envios e demais categorias de conteúdo. Uso lógico e físico segue a atribuição/deduplicação da medição existente, consultado dentro da transação. Uploads novos ficam associados à caixa escolhida; anexos de outra caixa são recusados. Metadados operacionais continuam podendo mudar no limite, com seu consumo contabilizado e a exceção documentada.
- Sincronização grava pasta, UIDVALIDITY, último UID confirmado e primeiro pendente quando a capacidade acaba. Retoma pelo checkpoint ao ampliar o limite ou liberar espaço, sem duplicar mensagens. Envio valida todo o conteúdo local antes do SMTP; falha de capacidade não entrega a mensagem.
- Validação: lint, typecheck e build de todos os pacotes; 57 testes unitários, 62 integrações da API, 31 integrações do worker e 2 testes de migrations aprovados em QA. Após os últimos ajustes de concorrência/validação, repetidos os dois cenários de cota do worker e o cenário de autorização/payload da API. Inclui crescimento concorrente, limites acima da precisão de Number, isolamento entre empresas/caixas, alocação manual, checkpoint e bloqueio anterior ao SMTP.
- Interface conferida em 16 combinações de empresa/superadmin, claro/escuro e 1440/900/390/320 px: sem overflow horizontal, erros JavaScript ou violações axe WCAG A/AA. Fixtures usadas nas respostas do navegador; integrações de API/worker usam PostgreSQL, Redis, arquivos e IMAP/SMTP reais de QA. Relatório local ignorado pelo Git: `.data/qa/quotas-browser-report.json`.
- **Somente implementação local, sem commit, push, deploy ou mudanças em produção.** Aplicar `0018_storage_quotas.sql` e atualizar API/web/worker juntos na publicação. Concluir reconciliação inicial dos arquivos legados antes de definir cotas finitas. Não limpar banco ou volumes. Detalhes em [COTAS-ARMAZENAMENTO.md](COTAS-ARMAZENAMENTO.md) e [DEPLOY.md](DEPLOY.md).

## Correção de 06/10/2026 — cadastro de empresa com proprietário novo

- Diagnóstico confirmado em leitura dos logs de produção: `POST /api/superadmin/tenants` falhava com PostgreSQL `23514`, pois `invitations_tenant_role_check` proibia o papel `owner`. A produção estava com as migrations até `0016`; as tentativas com identificador `teste` foram revertidas pela transação, sem deixar empresa cadastrada.
- Nova migration `0017_platform_owner_invitations.sql` permite convite de proprietário somente com `sender_context = 'platform'`. Convites comuns e legados continuam impedidos de conceder esse papel. As migrations anteriores permanecem intactas.
- Regressões para cadastro com proprietário novo, job de convite pelo SMTP global, aceitação como proprietário ativo, bloqueio de reutilização do token, identificador duplicado, vínculo de conta existente e proibição de convite comum para proprietário. O caso novo reproduziu HTTP 500 antes da correção.
- Validação: lint, formatação, typecheck e build da API aprovados. Os 26 cenários de integração em `evolution.test.ts` e `dashboard.test.ts` passaram com timeout de 30 segundos para o túnel SSH; os demais 27 cenários da API passaram na execução inicial. Inclui três regressões novas desta correção. Dois testes de migrations aprovaram aplicação desde banco vazio, proteção de checksum e rollback; a migration também foi conferida em outra base QA nova, removida ao final, sem modificar a produção.
- Implementação local, sem commit/push/deploy e sem alteração de dados ou esquema em produção. Para corrigir no servidor, o deploy do usuário deve aplicar a migration `0017`; não é necessário limpar o banco.

## Ajuste de 05/10/2026 — menu lateral e barras da caixa/conversa (local)

- Implementado no workspace, sem commit, push, deploy ou alteração adicional em produção.
- Corrigido o crescimento da tabela interna do ScrollArea: o menu respeita a largura do painel em desktop e no menu móvel. Nomes longos usam reticências com o texto completo disponível; setas, contadores e opções de pasta reservam seu próprio espaço.
- Filtros da caixa com busca/atualização alinhadas, responsável/ordenação em duas colunas, rótulos visíveis e seleção/leitura em linha própria. Limpar filtros mantém a navegação interna e retorna à primeira página.
- Ações da conversa agrupadas com alturas/espaçamentos consistentes e quebra de linha conforme a largura disponível. Compartilhar, atribuir e etiquetar permanecem acessíveis; mover/restaurar/excluir ficam em Organizar, e leitura/fixação em Mais ações. Responsável atual aparece uma única vez.
- Diálogos de mover/excluir devolvem foco ao botão de origem; exclusão mantém confirmação explícita. Controles principais preservam 44 px em celulares e foco visível, nos dois temas.
- Validação: lint, typecheck de todos os pacotes, build web e 16 testes web aprovados. **60 verificações de navegador**, com 21 inspeções axe sem violações: 1440/1024/900/390/320 px, claro/escuro, painéis redimensionados, filtros combinados, seleção em lote, teclado, retorno de foco, recolhimento/ocultação do menu e nomes longos com contadores de seis dígitos. Respostas GET reais reaproveitadas entre resoluções; nomes/contadores extremos usados somente como fixtures de interface. Sem erros JavaScript; sem ensaio manual com NVDA/VoiceOver. Relatório local ignorado pelo Git: `.data/qa/mail-layout-browser-report.json`.

## Entrega de 05/10/2026 — consumo verificável, dashboard e limpeza autorizada

- **Fases 0–6 implementadas no workspace, sem commit, push ou deploy.** Novas migrations aplicadas somente em QA. A limpeza de produção descrita abaixo foi expressamente autorizada pelo usuário.
- Plano completo em [PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md](PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md), vinculado à [SPEC](SPEC-EVOLUCAO-APMAIL.md).
- Cadastro e propriedade dos arquivos, conferência com disco, dados lógicos por categoria, retenção, divergências, reconciliação e histórico implementados. Banco físico/índices/WAL, backups, Redis, logs, recursos e capacidade ficam separados como infraestrutura compartilhada, sem rateio apresentado como exato.
- Dashboard global e detalhes por empresa/caixa: uso, crescimento, rankings, saúde, sincronização, filas, integridade e atividade administrativa. Superadmin permanece sem leitura de mensagens/anexos; gerenciamento de usuários/caixas continua após seleção da empresa.
- Sem planos comerciais, preços, cotas por cliente, bloqueios por consumo ou nova limpeza automática. Operação, fontes opcionais e publicação em [OPERACAO-ARMAZENAMENTO.md](OPERACAO-ARMAZENAMENTO.md). API/web/worker e migrations aditivas precisam ser publicados juntos pelo usuário; fontes do host exigem Node 22 e permissões de leitura explicitamente configuradas.
- Validação: lint, typecheck, build, 53 testes unitários e 83 integrações reais (DB 4, API 50, worker 29) PostgreSQL/Redis/filesystem/GreenMail. Inclui dois tenants, compartilhamento entre caixas, upload consumido, conflito físico entre empresas, lock entre conexões, solicitação concorrente e retomada de continuação cancelada. **25 verificações de navegador**, incluindo empresa selecionada em 1440/900/390 px e claro/escuro, teclado/foco/redução de movimento; sem erros JavaScript ou violações graves no axe. Contraste do hover escuro nos botões corrigido. Sem ensaio manual com NVDA/VoiceOver.
- Carga concluída: 1.000.000 mensagens, 100 caixas e 100.000 arquivos; bytes presentes 1.600.000 e alocados 409.600.000, sem divergências. Reconciliação 881.191 ms em 43 lotes; pico de RSS 127.979.520 bytes, um núcleo e limite 768 MiB. Dados atribuídos 1.031.737.925 bytes, incluindo payload lógico de 1.030.137.925 bytes. Relatório remoto `.data/qa/storage-scale-report.json`.
- Backup final `/home/administrador/apmail-next/.data/backups/production/20261005T182009Z`, com dump, arquivos, Redis, chaves privadas e checksums. Restauração independente conferiu 748 mensagens e 253 arquivos/7.123.799 bytes com SHA-256 individual; Redis RDB aprovado. As migrations `0011`–`0016` e o reset foram ensaiados em banco/volumes próprios antes da limpeza real. Cópias de produção no laboratório removidas após a conferência.
- Produção zerada conforme autorização: **1 usuário/1 superadmin, 0 empresas, 0 caixas, 0 mensagens, 0 vínculos e 0 arquivos**. Sessão de validação encerrada. Preservados schema/migrations `0010`, imagens publicadas, domínio, SMTP, segredos e backups. Banco/Redis saudáveis, login HTTPS e negação de acesso operacional aprovados. Credenciais privadas fora do repositório, sem senha em docs/logs/Git.
- Domínio atual conferido no APP_URL e no roteador: **https://app.apmail.com.br**. SMTP global configurado. O novo dashboard ainda depende do commit/deploy pelo usuário; a limpeza e o acesso já estão disponíveis na versão publicada.

## Atualização de 05/10/2026 — gestão por empresa e rolagem do menu (local)

- **Implementado no workspace; sem commit, push ou deploy.** Publicação no Dokploy a cargo do usuário. Sem migração adicional e sem mudanças em produção.
- /superadmin começa no seletor de empresas. Seleção fica visível e na URL; usuários, caixas, armazenamento, auditoria e logs permanecem no contexto escolhido. Troca de empresa limpa filtros/paginação e não conserva dados da anterior durante carregamento. Saúde da plataforma permanece global.
- Criar/editar empresas; criar usuários com senha inicial e configurar acessos em seguida; editar nome/e-mail/senha, convidar e ativar/desativar vínculos. Conta existente é vinculada por convite. O formulário explica identidade compartilhada entre empresas; trocar e-mail/senha invalida sessões. Contas globais não recebem acesso operacional e não aparecem na equipe empresarial.
- Criar/editar caixas com configuração IMAP/SMTP, remetente e cópia em Enviados. Credenciais nunca retornam ao cliente; autenticação de conexões alteradas ocorre antes da gravação. Edição parcial preserva campos omitidos, incluindo aliases e classificação histórica. Listagens de usuários/caixas exigem empresa na API; configuração/edição valida vínculo no servidor.
- Menu lateral reutiliza ScrollArea com indicador fino, arredondado, neutro e exibido durante interação, nos dois temas e no menu móvel. Roda do mouse e foco por teclado conferidos.
- Validação: lint, typecheck, build e 51 testes unitários; 77 integrações de QA em Linux (DB 2, API 46, worker 29) com PostgreSQL/Redis/IMAP/SMTP reais. Inclui criação/edição/isolamento, senha e revogação de sessão, ocultação de credenciais e falhas de conexão sem alterar cadastros válidos.
- Navegador Edge: cadastro/edição de empresa, usuário e caixa de laboratório, permissões, contexto inválido, troca de empresa e histórico sem recarga, armazenamento restrito; painel, formulário e menu em 1440/900/390 px e claro/escuro. Sem erros JavaScript ou violações sérias/críticas no axe. Relatório local .data/qa/management-browser-report.json e screenshots management-*, ignorados pelo Git.
- Documentação de contrato e publicação atualizada em [SPEC](SPEC-EVOLUCAO-APMAIL.md) e [DEPLOY](DEPLOY.md).

## Atualização de 05/10/2026 — superadmin exclusivo e armazenamento (local)

- **Implementado e validado no workspace; sem commit, push ou deploy.** O usuário fará a publicação no Dokploy. A versão anterior em produção permanece a descrita na seção seguinte.
- Superadmin entra somente em `/superadmin`. Vínculos antigos de proprietário/admin e sessões legadas de suporte não concedem contexto empresarial. API nega caixas, mensagens/anexos privados, contatos, chat, notificações e dashboard operacional; Socket.IO rejeita contas globais; o bootstrap publica revogação no canal Redis da aplicação e encerra conexões já abertas em todas as instâncias de API. Entrar em suporte foi retirado; histórico/auditorias preservados.
- Gestão global continua com empresas, usuários, conexões de e-mail, auditoria, logs e saúde. A concessão empresarial a outra conta global e o uso dela como novo proprietário são bloqueados. O painel identifica contas globais e oferece claro/escuro. Contas distintas são necessárias para plataforma e atendimento empresarial.
- Worker revalida o papel antes de SMTP/IMAP: envios de uma conta promovida a superadmin falham, organização pendente é revertida e mudanças de pastas são interrompidas. Convite empresarial pendente de ator global não usa credenciais de caixa; convites da plataforma continuam pelo SMTP global.
- Armazenamento por empresa e caixa em seção própria, com busca sem distinção de caixa/acentos, ordenação, paginação, totais filtrados, atualização e detalhamento das caixas da empresa. Consulta exclusiva do superadmin, sem devolver corpos, anexos ou caminhos físicos. Totais/página são calculados no mesmo snapshot SQL.
- Métrica estimada de payload: corpos UTF-8 de mensagens/outbox, anexos únicos por caminho, uploads pendentes e assinaturas. Dados excluídos ainda retidos contam. Metadados de uploads consumidos não contam; tamanho original MIME não é somado aos anexos. Compartilhado da empresa fica separado das caixas. RAM, índices/TOAST/WAL, avatares, backups e arquivos órfãos exigem medição separada para uma futura cobrança por volume físico.
- Validação: lint, typecheck, 51 testes unitários e build; PostgreSQL/Redis/IMAP/SMTP de QA em Linux: 73 integrações (DB 2, API 42, worker 29). Casos de proprietário legado, suporte legado, bloqueio HTTP/socket/worker, concessão a conta global e consistência/deduplicação/paginação do armazenamento cobertos. Após excluir uploads consumidos da métrica, as 11 integrações de evolução foram reexecutadas com sucesso.
- Navegador: duas visões de armazenamento em 1440/900/390 px e claro/escuro; rotas operacionais redirecionam a conta global, teclado/navegação sem recarga, busca, ordenação, filtro de empresa e alternância de tema conferidos. Sem erros JavaScript, overflow da página ou violações sérias/críticas no axe. Relatório local `.data/qa/platform-browser-report.json` e screenshots `platform-storage-*`, ignorados pelo Git.
- Nenhuma nova migração. Antes da publicação, manter um proprietário/admin comum para a empresa: a conta global existente também perde o acesso operacional que recebia de seus vínculos antigos. Recriar API/worker/web juntos aplica a revisão e encerra conexões antigas. Detalhes em [DEPLOY](DEPLOY.md) e [SPEC](SPEC-EVOLUCAO-APMAIL.md).

## Atualização de 05/10/2026 — dashboard, conexão e assinatura

- Dashboard padrão para todos. Membro consulta seus envios, atendimentos atribuídos e conclusões realizadas; Supervisor/Admin consulta o conjunto permitido e filtra usuários, caixas e período. A API protege todas as seis consultas e CSV, inclusive pastas restritas e ausência de caixas. Permissão de dashboard retirada dos controles de concessão do Supervisor.
- Assistente testa IMAP/SMTP antes de continuar; API retesta antes de salvar. Cadastro normal/superadmin e alterações de servidor/senha são bloqueados quando a autenticação falha, sem gravar caixa nem sobrescrever credenciais válidas. SMTP verifica autenticação sem enviar mensagem.
- Assinatura com upload exclusivo de imagem, PNG normalizado e incorporação CID no MIME. Prévia e reabertura exibem a imagem; API inclui assinatura por ID e recupera wrapper vazio. URLs antigas de imagens do APMail são convertidas no envio; cópia Enviados/IMAP conserva bytes e Content-ID. Imagens externas legadas exigem upload para incorporação.
- Verificações locais: lint, typecheck, testes unitários e build; Linux com PostgreSQL/Redis/IMAP/SMTP reais: 51 unitários + 70 integrações. MIME recebido, rascunho, cópia IMAP, isolamento por usuário/empresa/pasta e gravação bloqueada em falhas de ambos os protocolos cobertos.
- Navegador: proprietário e membro, desktop 1440, tablet 900 e celular 390, claro/escuro; sem overflow e sem violações sérias/críticas no axe. Upload sem URL, prévia/reabertura/compositor e conexão inválida mantendo formulário e banco conferidos. Evidência local em `.data/qa/october-browser-report.json` e screenshots `october-dashboard-*` (ignorados pelo Git).
- **Publicado em produção** no servidor local, commit `6d0f71115dbc4408f93fcb447148b41452033d45`, em [APMail](https://apmail.aptechinfo.com.br:75). [CI da branch](https://github.com/APTechSolucoesTI/APMail/actions/runs/37315522047) e [CI main](https://github.com/APTechSolucoesTI/APMail/actions/runs/37316082801) concluídas com sucesso, inclusive Docker/saúde. Dokploy deployment `15UF8g87qOq2AKHKDlX5G`: done; migração exit 0, cinco serviços healthy.
- Backup consistente anterior ao redeploy: `/home/administrador/apmail-next/.data/backups/production/20261005T131854Z`. Nenhuma nova migração de esquema. Domínio, ambiente/SMTP e volumes preservados, com hash do ambiente Dokploy igual antes/depois. Contagens antes/depois iguais: 748 mensagens, 579 conversas, 251 anexos, 2 usuários, 2 caixas, 2 credenciais e 3 itens existentes de outbox.
- Smoke público: saúde HTTP 200/Postgres/Redis ok; dashboard filtra usuário; cadastro com conexão inválida retorna 422 sem gravar; assinatura existente convertida para CID, imagem visível ao reabrir rascunho e arquivo incorporado no MIME montado pelo worker de produção. /superadmin disponível. Rascunho temporário removido, nenhuma mensagem enviada pela caixa real. Relatório local `.data/qa/october-production-report.json`, sem erros de JavaScript.

Atualização: 02/10/2026. Não considerar uma fase concluída até todas as verificações estarem comprovadas.

## Pré-implementação

- [x] Prompt inteiro lido.
- [x] SSH autenticado e acesso ao Docker validado.
- [x] Dokploy autenticado e listagem de projetos validada.
- [x] PostgreSQL 17 autenticado; criação de bancos permitida.
- [x] GitHub vazio e permissão de escrita confirmada.
- [x] Recursos preexistentes identificados e preservados.

## Fase 0 — Fundação

- [x] Monorepo, ferramentas, configuração estrita e dependências instaladas.
- [x] PostgreSQL, Redis, GreenMail e Mailpit exclusivos sobem saudáveis.
- [x] Migrations e reset executados; tipos gerados do banco real.
- [x] Saúde da API via proxy Vite responde ok para banco e Redis.
- [x] Teste de imutabilidade da migration e rollback validado.
- [x] Componentes, tabela, colunas, seleção e estados testados.
- [x] Temas e foco inspecionados em desktop, tablet e mobile.
- [x] API e worker encerram graciosamente.
- [x] Lint, typecheck, testes unitários, integração e build passam.
- [x] CI verde; merge, tag e push concluídos.

CI: https://github.com/APTechSolucoesTI/APMail/actions/runs/36860749036 — aprovado. Tag: `fase-0`.

## Fase 1 — Autenticação e permissões

Concluída.

- [x] Migration de usuários, sessões, empresas, convites, caixas e auditoria.
- [x] API de sessão, CSRF, rate limit, autorização e endpoints de configuração.
- [x] Worker com e-mails de sistema e limpeza de autenticação.
- [x] Cadastro, onboarding, configurações, assistente de caixas e notificações.
- [x] Testes de isolamento, permissões, último proprietário, convites e recuperação de senha.
- [x] Fluxos completos no navegador e no Mailpit validados.
- [x] Preferências autenticadas persistem após recarregar; restauração validada.
- [x] Desktop, tablet e mobile inspecionados nos dois temas, sem overflow ou erros de JavaScript.
- [x] Lint, typecheck, testes, build, reset e geração de tipos.
- [x] Verificação Linux final, CI, merge, tag e push.

Evidências: 14 testes unitários; 11 testes de integração, incluindo autenticação Socket.IO com Referer; QA real com cadastro, empresa, assistente de caixa, convite entregue no Mailpit, remoção de acesso em sessão aberta, desativação imediata e recuperação de senha com invalidação das sessões antigas.

CI: https://github.com/APTechSolucoesTI/APMail/actions/runs/36873520325 — aprovado. Tag: `fase-1`.

## Fase 2 — Sincronização

Concluída.

- [x] Migrations e tipos reais de pastas, threads, mensagens, anexos e ações.
- [x] Conexão IMAP/SMTP, sincronização incremental e reconciliação.
- [x] Agrupamento por referências e assunto com participantes.
- [x] Sanitização HTML, bloqueio de imagens externas e anexos autenticados.
- [x] Movimentos, Lixeira, restauração e sinalização confirmados no IMAP.
- [x] API com isolamento, leitura individual e permissão de organização.
- [x] Lista e leitura responsivas, pastas e atualização em tempo real.
- [x] 12 e-mails importados em 8 conversas; prefixos encadeados agrupados.
- [x] QA nos três tamanhos e dois temas, sem overflow ou erros JS.
- [x] Reinício real do Redis restaura schedulers e sincronizações.
- [x] Testes completos de integração: 21 aprovados.
- [x] Linux final, CI, merge, tag e push.

Evidências: fixtures MIME, remoção externa, troca de UIDVALIDITY, lock concorrente, erro por senha inválida e reconexão, CID visível, PDF com nome UTF-8 e bloqueio de imagens externas até autorização.

CI: https://github.com/APTechSolucoesTI/APMail/actions/runs/36894254853 — aprovado. Tag: `fase-2`. Linux Node 22: lint, typecheck, 21 testes unitários e 21 de integração, reset, geração de tipos, build e SIGTERM aprovados. Assistente confirmou IMAP/SMTP ativos no navegador.

## Fase 3 — Composição e envio

Concluída. Tag `fase-3`. CI final [36902987267](https://github.com/APTechSolucoesTI/APMail/actions/runs/36902987267) aprovado.

- [x] Migrations de uploads, assinaturas e outbox; tipos reais.
- [x] API de rascunhos, anexos, assinaturas, submit/cancel/send-now/retry.
- [x] Worker SMTP/MIME, cópia IMAP, deduplicação, sweep e limpeza.
- [x] Testes de destinatários, citação e horários em UTC.
- [x] Integração real de envio, resposta, anexos íntegros, cancelamento e retentativas.
- [x] QA final do compositor, agendamento no horário e recuperação do Redis.
- [x] Desktop, tablet e mobile nos dois temas; rascunho, upload, recarga, Desfazer e resposta de outro usuário.
- [x] 24 testes unitários e 28 de integração, lint, typecheck e build locais.
- [x] Revisão visual, checks completos, CI, merge e tag.

Evidências: agendamento real entregue em 1.359 ms após o horário; perda do banco lógico exclusivo de desenvolvimento do Redis com job reconstruído antes do prazo e entrega em 1.550 ms. MIME do navegador confirmou assinatura pessoal e arquivo UTF-8. Painel desktop de 640 × 560 px com minimizar, maximizar, rodapé persistente e confirmação de troca validado nas seis combinações de tela e tema. Aliases editados pela interface e sugestões recentes de endereços conferidos. Linux: 24 testes unitários, 28 de integração, migrations do zero, build e encerramento gracioso aprovados.

## Fase 4 — Organização

Concluída. Tag `fase-4`. CI final [36911301148](https://github.com/APTechSolucoesTI/APMail/actions/runs/36911301148) aprovado.

- [x] Migration de etiquetas e regras; tipos reais de 26 tabelas.
- [x] Operadores e validação de escopo testados, com comparação sem acentos.
- [x] API de pastas, etiquetas próprias, regras e ações em lote.
- [x] Busca SQL, paginação com total confiável, filtros e ordenação.
- [x] Worker de pastas e regras, recuperação após falha e encaminhamento idempotente.
- [x] 22 testes de integração do worker no Linux, incluindo isolamento entre empresas.
- [x] Gestão de pastas, regras e etiquetas na interface.
- [x] Revisão de acessibilidade e responsividade nos dois temas.
- [x] Checks completos, CI, merge e tag.

Evidências: 33 testes unitários e 33 de integração aprovados no Linux; reset do banco exclusivo de testes, geração de tipos, lint, typecheck, build e SIGTERM. QA real confirmou criação/renomeação de árvore IMAP, exclusão de pasta vazia, regras de caixa e pessoais, etiquetas privadas, busca sem acentos e destaque de resultados. Reaplicação dos últimos 30 dias executou com payload `rule_id`/`since_days`, uma tentativa e encaminhamento idempotente. E-mail novo foi movido pela regra de caixa e recebeu somente a etiqueta do usuário criador. As três telas e os painéis de pastas/editor foram conferidos nas seis combinações de viewport e tema, com teclado, sem overflow ou erros de JavaScript.

## Fase 5 — Filas e notas

Concluída. Tag `fase-5`. CI final [36921362628](https://github.com/APTechSolucoesTI/APMail/actions/runs/36921362628) aprovado.

- [x] Migration de histórico e notas; tipos reais de 28 tabelas.
- [x] Algoritmo completo, reabertura por inbound e lock de recomputação.
- [x] Atribuição, ações em lote, SLA, histórico e notas com menções autorizadas.
- [x] Presença de composição com TTL e limpeza aguardada no encerramento.
- [x] Worker de recálculo e atribuição por regras com auditoria/notificação.
- [x] Linux: 35 testes unitários, 38 de integração, lint, typecheck, reset, tipos, build e SIGTERM.
- [x] QA final de filas, agendamento, menções e presença no navegador.
- [x] Desktop, tablet e mobile nos dois temas.
- [x] CI, merge e tag.

Evidências: `mail:test` criou e-mail em A responder; editor assumiu, agendou pela interface e o proprietário viu o agendamento e a presença de composição. Entrega real ocorreu 936 ms após o horário, passando para Aguardando resposta. `mail:test --reply-last` reabriu Em atendimento mantendo o responsável; conclusão manual e nova resposta reabriram com histórico/autor/motivo corretos. Newsletter permaneceu sem fila. Menção inserida por teclado notificou o leitor, que recebeu a nota em tempo real sem controles de escrita. SLA de 1 h e mensagem de 2 h atrás foram conferidos nas seis combinações de tela/tema; configuração de demonstração restaurada. Filas, notas, histórico e seleção de responsável foram revisados com teclado nas seis combinações, sem overflow ou erros JS. Recomposição concorrente de quatro transações produziu somente um registro de histórico. Entrada/saída/reentrada rápida de Socket.IO preservou a sala, com teste de regressão.

## Fase 6 — Dashboard

Concluída. Tag `fase-6`. CI [36925532922](https://github.com/APTechSolucoesTI/APMail/actions/runs/36925532922) aprovado.

- [x] Seis consultas SQL, índices e isolamento por tenant/caixa administrada.
- [x] Dados fixos conferem métricas, fuso, zeros, spam, automáticos e produtividade.
- [x] Interface com oito indicadores, gráficos, tabelas e exportação CSV.
- [x] QA de filtros, permissões e seis combinações de tela/tema.
- [x] Linux: 37 testes unitários, 42 de integração, reset, tipos, lint, typecheck, build e SIGTERM.
- [x] CI, merge e tag.

Evidências: seis endpoints conferidos com dados fixos, incluindo mensagens importadas versus enviadas pelo APMail, Spam, automáticos, Lixeira, exclusão, dias sem movimento, limites no fuso da empresa e resposta cuja mensagem anterior está fora do período. Editor e leitor restritos não veem o menu e recebem 403; administrador de caixa vê somente sua caixa; proprietário reúne todas. Contas temporárias de QA removidas ao final. Dashboard, gráficos e tabelas conferidos nas seis combinações de tela/tema, com um h1, sem overflow ou erros JS. Filtros persistem na URL e após recarga; cards abrem a fila escolhida; CSV inclui acentos e neutraliza fórmulas. Linux final: 37 testes unitários e 42 de integração, reset exclusivo de TEST, geração de tipos de 28 tabelas, lint, typecheck, build e SIGTERM.

## Fase 7 — Chat

Concluída. Tag `fase-7`. CI [36932248897](https://github.com/APTechSolucoesTI/APMail/actions/runs/36932248897) aprovado.

- [x] Migration, tipos de 31 tabelas e API de diretas, grupos e mensagens.
- [x] Idempotência, cursor estável, leitura, edição/exclusão e compartilhamento autorizado.
- [x] Eventos de salas, digitação e presença online com múltiplas abas.
- [x] Seis testes de integração do chat aprovados com Postgres/Redis reais.
- [x] Interface, envio otimista, compartilhamento e badge de não lidas.
- [x] Duas sessões: entrega em 893 ms, digitação, leitura, edição, exclusão e saída de grupo.
- [x] Desktop, tablet e mobile nos dois temas, sem overflow ou erros JS.
- [x] Falha de rede e retry com o mesmo client_id sem duplicação; histórico de 70 mensagens e edição expirada.
- [x] Enter/Shift+Enter, menus e diálogo de edição operados por teclado; conta temporária removida.
- [x] QA com dois navegadores, seis layouts, checks completos, CI, merge e tag.

Evidências: compartilhamento abre o e-mail para quem tem acesso e apresenta “Você não tem acesso a esta caixa” para participante sem permissão. A notificação do navegador foi conferida com a API instrumentada, permissão concedida e aba oculta; não representa um teste de popup do sistema operacional. Sair do grupo remove acesso HTTP e à sala; adicionar novamente restaura o acesso. Cursor preserva microssegundos do PostgreSQL e desempata por ID. Recarga do histórico conserva mensagens pendentes ou com falha até a confirmação do servidor.

Linux final: 45 testes unitários e 48 de integração aprovados, reset exclusivo de TEST, tipos de 31 tabelas, lint, typecheck, build e SIGTERM. Checks locais e CI também aprovados.

## Fase 8 — Endurecimento

Concluída. Tag `fase-8`. CI [36939591795](https://github.com/APTechSolucoesTI/APMail/actions/runs/36939591795) aprovado.

- [x] Migration aplicada e tipos reais de 32 tabelas.
- [x] Restrição de pastas com herança por descendentes, isolamento de empresa e negação por seleção vazia.
- [x] Listagens, busca, detalhe, anexos, contadores, sugestões, compartilhamento e salas Socket.IO filtrados no servidor.
- [x] Seletores em Membros da caixa e no diálogo de permissões; revogação refletida imediatamente na tela.
- [x] Atalhos de teclado e diálogo de ajuda; campos de edição e modais não disparam ações da caixa.
- [x] Auditoria com filtros combinados e metadados sem segredos; logs com request_id e saúde das filas restrita a administradores.
- [x] Carga real de 50.000 mensagens e 20.000 conversas no banco exclusivo de testes.
- [x] Seis layouts de pastas, leitura restrita e auditoria, com teclado e revogação ao vivo.
- [x] Revisão final de rotas, contraste, teclado e redução de movimento.
- [x] Checks completos no Linux, revisão do bundle, limpeza dos dados temporários, CI, merge e tag.

Performance: `EXPLAIN ANALYZE (BUFFERS, FORMAT JSON)` executado sobre a mesma consulta compilada usada pela API, em PostgreSQL 17. Listagem por pasta: **121,216 ms**; filas: **124,310 ms**; busca: **50,659 ms**. Todas abaixo da meta de 300 ms. Fixture isolada em `apmail_test`; o gerador recusa bancos cujo nome não termina em `_test`. Índices de árvore de pastas e cronologia de mensagens legíveis incluídos na migration.

Revisão por tela: as colunas abaixo correspondem aos checklists de design, desenvolvimento e acessibilidade/QA. Revisão operacional em 114 combinações de rota, tamanho e tema; autenticação pública em 30 combinações, mais onboarding. Sem overflow, um h1 por página, sem erros de JavaScript ou violações detectadas pelo axe-core nos critérios WCAG 2 A/AA e 2.1 AA. Teclado e redução de movimento conferidos; os fluxos completos de cada módulo também têm as evidências das fases anteriores. Isso não substitui uma auditoria manual integral de conformidade WCAG.

| Tela/rota                                                       | Design | Desenvolvimento | Acessibilidade/QA |
| --------------------------------------------------------------- | ------ | --------------- | ----------------- |
| Entrar, cadastrar, recuperar e redefinir senha, aceitar convite | [x]    | [x]             | [x]               |
| Onboarding                                                      | [x]    | [x]             | [x]               |
| Meu perfil                                                      | [x]    | [x]             | [x]               |
| Preferências                                                    | [x]    | [x]             | [x]               |
| Equipe e permissões                                             | [x]    | [x]             | [x]               |
| Empresa                                                         | [x]    | [x]             | [x]               |
| Lista de caixas                                                 | [x]    | [x]             | [x]               |
| Configuração da caixa e membros/pastas                          | [x]    | [x]             | [x]               |
| Assinaturas                                                     | [x]    | [x]             | [x]               |
| Etiquetas                                                       | [x]    | [x]             | [x]               |
| Regras                                                          | [x]    | [x]             | [x]               |
| Auditoria e detalhes                                            | [x]    | [x]             | [x]               |
| Dashboard                                                       | [x]    | [x]             | [x]               |
| Lista e leitura de e-mail                                       | [x]    | [x]             | [x]               |
| Rascunhos, agendados, na fila e com falha                       | [x]    | [x]             | [x]               |
| Lista do chat e conversa                                        | [x]    | [x]             | [x]               |
| Ajuda de atalhos                                                | [x]    | [x]             | [x]               |

Os ajustes incluíram contraste dos tokens claros e das abas, painel associado às abas de Envios e histórico do chat/tabelas roláveis acessíveis por teclado. A caixa desativada e a pessoa temporária de QA foram removidas, preservando as caixas reais e os serviços de outros projetos. A revogação no navegador retornou 404 e retirou o conteúdo em cache; o worker recusou resposta e anexo original após o agendamento, antes de construir MIME ou acessar SMTP.

Linux final: lint, typecheck, **48 testes unitários**, **55 de integração**, reset exclusivo de TEST, tipos de 32 tabelas, build e SIGTERM aprovados. Build local aprovado e bundle comparado aos valores sensíveis do ambiente, sem ocorrência. CI aprovado. A integração cobre também auditoria filtrada e remoção de metadados sensíveis de registros históricos, além do encerramento independente de instâncias Socket.IO.

## Fase 9 — Produção

Entrega técnica concluída conforme os critérios de aceite Docker da Fase 9. Tag `fase-9`. Instalação gerenciada pelo Dokploy validada com stack, volumes e segredos exclusivos. A publicação externa permanece pendente: domínio/DNS, HTTPS, SMTP real e conexão das caixas reais precisam dos dados do usuário.

- [x] Compose principal sem portas públicas; override local com bind em loopback.
- [x] Dockerfiles API/worker/web e nginx com DNS renovado, WebSocket, CSP e cache dos assets.
- [x] PostgreSQL/Redis/API/worker/web saudáveis e migration concluída com código 0.
- [x] Execução sem root: UIDs 70, 999, 1000, 1000 e 101, respectivamente.
- [x] Cadastro → empresa → caixa → sincronização → resposta com anexo → dashboard → convite → chat na stack Docker.
- [x] IMAPS/SMTPS com certificado confiável de teste e validação TLS ativa.
- [x] Reinício da API preserva web, reconecta socket e restabelece a sala do chat sem recarga.
- [x] Down/up preserva Postgres, Redis/AOF e hash do anexo.
- [x] Backup e restauração em banco/volume separados; mensagens e hash do anexo conferidos.
- [x] README e guia completo de ambiente, Dokploy, HTTPS, backup, restauração e manutenção.
- [x] CI [36941813302](https://github.com/APTechSolucoesTI/APMail/actions/runs/36941813302) aprovado, incluindo 48 testes unitários, 55 de integração, build Docker, saúde, migration e UIDs.
- [x] Projeto APMail e serviço Compose exclusivos criados no Dokploy, provedor GitHub/main e segredos novos.
- [x] Deploy GitHub/main concluído pelo Dokploy, cinco serviços saudáveis e migration com código 0.
- [x] Proprietário e empresa APTech criados; cadastro público desativado e recusa 403 conferida após redeploy.
- [x] Sessão preservada, seis layouts sem overflow/erros de JavaScript e imagens não-root conferidas na instalação gerenciada.
- [x] Backup automatizado testado, checksums conferidos e proprietário restaurado em banco separado; cron diário às 03h do host (-03).
- [x] Guia final, acesso privado entregue, CI, merge e tag.
- [ ] Domínio final/HTTPS e SMTP externo informados e validados.
- [ ] Caixas reais conectadas e entrega externa conferida com as credenciais do usuário.

Inicialização local com imagens construídas: **34 segundos**. A aplicação não usa scripts inline; o inicializador de tema foi extraído para arquivo próprio após a CSP detectar o script da página inicial. O fluxo completo passou sem erros de JavaScript. O backup restaurou duas mensagens e anexos com hash idêntico; o teste de persistência também confirmou um marcador no Redis após down/up. Provedores GreenMail/Mailpit e restauração são exclusivos de QA, sem alteração dos serviços de outros projetos.

Dokploy: projeto `A0UfmHWgOBSv7SYUsbKgx`, ambiente `j8pFJm-Vkn6mTSijFpA2f`, Compose `R5nlKL0Qt47g_a4sxCeSc`, appName `apmail-next-production-qrufqc`. Deploy inicial `0xzjpQD43e0acSpq_9k-J` e redeploy `Wx5UPWC4OSVmz-SnPjjJq` concluídos. A prévia usa somente loopback 8081, acessível por túnel SSH. Credenciais de acesso em `.data/APMail-acesso-local.txt` e ambiente em `.data/qa/dokploy-production.env`, ambos fora do Git. O backup inclui banco, arquivos, snapshot Redis, chaves e checksums; diretório privado `/home/administrador/apmail-next/.data/backups/production`. Cron preserva os agendamentos preexistentes. Cópia externa/cofre e monitoramento dos backups ficam sob responsabilidade operacional da equipe; não há serviço externo configurado.

Evidências da fase 0: 14 testes unitários e 2 testes de integração aprovados; seis combinações de viewport e tema inspecionadas; SIGTERM validado no Linux com Node 22.

## Atualização do ambiente — 02/10/2026

As pendências de publicação registradas no fechamento da Fase 9 refletem aquele momento. Nesta análise, o `.env` atual do Compose no Dokploy e os ambientes efetivos de API/worker têm host, usuário, senha e remetente de SMTP global configurados, porta 587 e TLS implícito desativado. Autenticação com STARTTLS obrigatório foi verificada com sucesso, sem envio de e-mail. A URL HTTPS configurada respondeu HTTP 200 e saúde ok. Há uma caixa ativa conectada e os cinco serviços permanentes estão saudáveis. Entrega de convites/recuperação ao destinatário não foi testada nesta etapa.

Não foram alterados ambiente, containers, banco ou caixa durante essa conferência. As cópias locais antigas de configuração não devem sobrescrever o ambiente atual do servidor.

## Evolução — implementação autorizada em 02/10/2026

Especificação em [SPEC-EVOLUCAO-APMAIL.md](SPEC-EVOLUCAO-APMAIL.md). O usuário autorizou todos os módulos e `/superadmin`, com publicação conjunta.

- [x] Diagnóstico de navegação, editor, assinaturas, preferências, histórico e permissões.
- [x] Falhas de igualdade de e-mail/destinatário e espaços reproduzidas no avaliador atual.
- [x] Decisões confirmadas para contatos, histórico, densidade, suporte global e remetente dos convites.
- [x] Requisitos, dependências, modelo de dados, critérios de aceite e estratégia de publicação documentados.
- [x] Editor conforme controles solicitados por texto; print não disponível nesta conversa.
- [x] Editor HTML com fontes, tamanhos, cores, alinhamento, listas, links, tabelas, desfazer/refazer e imagens CID privadas; autosave e reabertura validados.
- [x] Upload de assinatura PNG/JPEG/WebP, normalização PNG e URL pública imutável; HTTPS usa domínio configurado.
- [x] Menu recolhível, agrupamento de pastas/configurações, navegação SPA e data/hora nas listagens.
- [x] Regras com comparação normalizada e prévia sem ações; guard de pasta também no destino de regra e worker.
- [x] Preferências simplificadas; histórico 0–90 dias com origem preservada em movimento e resposta nova ativando fila.
- [x] Contatos por empresa, vários e-mails e vínculos, unicidade concorrente, visibilidade por caixa, CNPJ/CEP com edição manual.
- [x] Supervisor com seis capacidades explícitas e isolamento de caixas/pastas.
- [x] SMTP da empresa e plataforma em contextos separados, sem credenciais no Redis; token substituído invalida jobs antigos e estado de entrega visível.
- [x] `/superadmin`, bootstrap, empresas/usuários/acessos/caixas, auditoria/logs/saúde, suporte de leitura auditado por 30 minutos.
- [x] Migrations 0009/0010 aplicadas em desenvolvimento, testes e restauração isolada, sem reset de produção.
- [x] Lint, typecheck, 51 testes unitários, 69 integrações e build aprovados. Navegador: contatos com CNPJ/CEP, SPA, editor/CID/reabertura, seis seções globais e suporte. 18 telas (3 rotas × 3 tamanhos × 2 temas), sem overflow, erros de JavaScript ou violações graves/críticas WCAG A/AA na verificação automatizada.
- [x] Backup consistente `20261002T195751Z`, checksums verificados; restauração preservou 1 usuário, 1 empresa, 1 caixa ativa, 717 mensagens e 556 conversas/filas. Ambiente atual: HTTPS e SMTP globais configurados, preservados para atualização.
- [x] CI da branch [37058656859](https://github.com/APTechSolucoesTI/APMail/actions/runs/37058656859) e da main [37059090779](https://github.com/APTechSolucoesTI/APMail/actions/runs/37059090779) aprovados, incluindo stack Docker com usuários não privilegiados e migration exit 0. Commit de implementação `d48682c`.
- [x] Publicação conjunta no Dokploy: deployment `vQhY9mj630g9rBtb6jJ-r`, cinco serviços saudáveis, migrations exit 0. HTTPS, SMTP, configuração e sessão existente preservados. Conferência posterior: mesmas 717 mensagens e mesmas filas (62 a responder, 469 aguardando, 24 sem fila e 1 concluída).
- [x] Super admin concedido à conta existente **sistema@aptechinfo.com.br**, mantendo senha; acesso em **https://apmail.aptechinfo.com.br:75/superadmin**. Concessão auditada pelo bootstrap.
- [x] Smoke em produção: saúde/worker, painel global, editor, novo contato sem persistir dados, navegação SPA, assinatura normalizada PNG acessível em HTTPS sem sessão e HTML preservado. Assinatura temporária de QA removida; imagem pública imutável de 2×2 pixels mantida conforme ciclo de vida. Nenhum e-mail foi enviado a destinatários reais na validação.
- [x] Banco temporário da restauração removido após validação; backup consistente preservado. Evidências locais privadas: `.data/qa/evolution-browser-report.json`, `.data/qa/evolution-production-report.json` e screenshots; segredos ausentes dos relatórios.
