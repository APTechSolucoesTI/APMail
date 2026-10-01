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
- [ ] CI verde; merge, tag e push concluídos.

## Fase 1 — Autenticação e permissões

Não iniciada.

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
