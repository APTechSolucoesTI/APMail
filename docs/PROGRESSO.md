# Progresso do APMail

Atualização: 01/10/2026. Não considerar uma fase concluída até todas as verificações estarem comprovadas.

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

Em implementação na branch `feat/fase-9-producao`. Compose e imagens em validação no servidor local, com stack e volumes exclusivos. Domínio e SMTP real continuam pendentes para publicação HTTPS e entrega externa de convites/recuperação.

Evidências da fase 0: 14 testes unitários e 2 testes de integração aprovados; seis combinações de viewport e tema inspecionadas; SIGTERM validado no Linux com Node 22.
