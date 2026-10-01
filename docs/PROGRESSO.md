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

Em implementação.

- [x] Migration de etiquetas e regras; tipos reais de 26 tabelas.
- [x] Operadores e validação de escopo testados, com comparação sem acentos.
- [x] API de pastas, etiquetas próprias, regras e ações em lote.
- [x] Busca SQL, paginação com total confiável, filtros e ordenação.
- [x] Worker de pastas e regras, recuperação após falha e encaminhamento idempotente.
- [x] 22 testes de integração do worker no Linux, incluindo isolamento entre empresas.
- [x] Gestão de pastas, regras e etiquetas na interface.
- [x] Revisão de acessibilidade e responsividade nos dois temas.
- [ ] Checks completos, CI, merge e tag.

Evidências: 33 testes unitários e 33 de integração aprovados no Linux; reset do banco exclusivo de testes, geração de tipos, lint, typecheck, build e SIGTERM. QA real confirmou criação/renomeação de árvore IMAP, exclusão de pasta vazia, regras de caixa e pessoais, etiquetas privadas, busca sem acentos e destaque de resultados. Reaplicação dos últimos 30 dias executou com payload `rule_id`/`since_days`, uma tentativa e encaminhamento idempotente. E-mail novo foi movido pela regra de caixa e recebeu somente a etiqueta do usuário criador. As três telas e os painéis de pastas/editor foram conferidos nas seis combinações de viewport e tema, com teclado, sem overflow ou erros de JavaScript.

## Fase 5 — Filas e notas

Não iniciada.

## Fase 6 — Dashboard

Não iniciada.

## Fase 7 — Chat

Não iniciada.

## Fase 8 — Endurecimento

Não iniciada.

## Fase 9 — Produção

Não iniciada. Domínio e SMTP real precisam ser configurados antes da validação final.

Evidências da fase 0: 14 testes unitários e 2 testes de integração aprovados; seis combinações de viewport e tema inspecionadas; SIGTERM validado no Linux com Node 22.
