# APMail — melhorias de usabilidade

Objetivo: integrar tarefas à conversa, exportar PDF corporativo, preservar rascunhos e oferecer Resumo e preferências individuais.
Arquitetura: manter React/TanStack Router, Fastify, Kysely/PostgreSQL e lembretes existentes. Resumo reutiliza a consulta de visibilidade com múltiplas caixas e paginação SQL. Preferência antiga de filas permanece armazenada sem controle individual; nenhum estado compartilhado será alterado.

- [x] PDF: endpoint protegido que carrega toda conversa visível; prévia, download e impressão; logo e metadados.
- [x] Tarefas: ampliar reminders com thread e criador; atribuição apenas admin; notificações existentes; impedir conclusão de atendimento com pendências no backend/banco.
- [x] Rascunhos: reproduzir perda de Para/CC/CCO e corrigir entrada, autosave e reabertura; preservar anexos.
- [x] Preferências: remover controle individual de filas, persistir 10/25/50/100 e opção Resumo; manter padrão 10.
- [x] Resumo: todas caixas/pastas autorizadas, contadores e filtros sobre conjunto agregado sem duplicação; origem identificada e ações na caixa real.
- [x] Interface: destinatários expandidos, clipe na assinatura, estados e temas existentes.
- [x] QA: regressões específicas, lint/typecheck/test/build, banco local e navegador 1440x900 / 768x1024 / 390x844; revisão e correção observada.
- [x] Aplicar migrations aditivas verificadas ao banco autorizado, entrega em main ao finalizar; sem deploy Dokploy.

Riscos: concorrência tarefa/conclusão; vazamento entre caixas/empresas; respostas usando conta errada; autosave sobrescrevendo estado recente. Testes devem cobrir esses comportamentos. Usuário forneceu especificação completa e autorizou execução autônoma, sem pausas por decisões simples.
