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

Em validação final.

- [x] Migration de usuários, sessões, empresas, convites, caixas e auditoria.
- [x] API de sessão, CSRF, rate limit, autorização e endpoints de configuração.
- [x] Worker com e-mails de sistema e limpeza de autenticação.
- [x] Cadastro, onboarding, configurações, assistente de caixas e notificações.
- [x] Testes de isolamento, permissões, último proprietário, convites e recuperação de senha.
- [x] Fluxos completos no navegador e no Mailpit validados.
- [x] Preferências autenticadas persistem após recarregar; restauração validada.
- [x] Desktop, tablet e mobile inspecionados nos dois temas, sem overflow ou erros de JavaScript.
- [x] Lint, typecheck, testes, build, reset e geração de tipos.
- [ ] Verificação Linux final, CI, merge, tag e push.

Evidências: 14 testes unitários; 11 testes de integração, incluindo autenticação Socket.IO com Referer; QA real com cadastro, empresa, assistente de caixa, convite entregue no Mailpit, remoção de acesso em sessão aberta, desativação imediata e recuperação de senha com invalidação das sessões antigas.

## Fase 2 — Sincronização

Não iniciada.

## Fase 3 — Composição e envio

Não iniciada.

## Fase 4 — Organização

Não iniciada.

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
