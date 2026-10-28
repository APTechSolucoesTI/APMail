# APMail Painel Administrativo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execução direta nesta conversa; não distribuir implementação a subagentes. Revisão final independente pode ser feita quando exigida pela skill de revisão.

**Goal:** Separar administração e operação do APMail, acrescentando domínios/DNS, agrupamento pessoal e política empresarial de filas, com conversas independentes do atendimento.

**Architecture:** Preservar o monorepo e criar um ambiente `/admin` dentro da aplicação atual, sem duplicar sessão, sockets ou transferências. Autorização por seção no Fastify e no roteador; novas tabelas PostgreSQL e serviços de domínio reaproveitam Kysely e workers existentes. A classificação de atendimento continua interna; mensagens são agrupadas por identidade e referências, nunca por assunto/participante.

**Tech Stack:** Node >=22.22.2, pnpm 12.8.1, React 19, TypeScript, Vite, TanStack Router/Query, Tailwind/shadcn New York, Fastify, PostgreSQL/Kysely, Redis/BullMQ, IMAP/POP3/SMTP existentes.

**Spec:** `docs/superpowers/specs/2026-10-28-painel-administrativo-design.md`, aprovado pelo usuário em 28/10/2026.

## Global Constraints

- Repositório `E:\Sistemas\APMail`; preservar trabalho local. Reutilizar o checkout atual, salvo necessidade real de isolamento descoberta antes da execução.
- Manter o Dashboard das caixas no ambiente de e-mail. Criar uma visão geral administrativa diferente.
- Sem mockups. Reutilizar o padrão visual existente.
- Sem migração de stack, reinicialização do shadcn, API de hospedagem, provisionamento remoto, alteração de DNS ou comprovação de propriedade.
- Novas migrations em `packages/db/migrations`, sem alterar as antigas, sem reset de banco real, com tipos gerados em QA.
- Agrupamento por domínio desativado por padrão; filas empresariais visíveis por padrão. Preferência individual antiga não controla mais as filas.
- Não dividir ou unir em massa conversas antigas já persistidas nesta entrega.
- Domínios não concedem acesso a e-mails. Usuário delegado acessa apenas seções e dados autorizados, no backend também.
- Usar o gerenciador correspondente ao lockfile: pnpm. Nenhum lockfile adicional.
- Valores operacionais, estados e ações devem ser legíveis, acessíveis e coerentes nos temas claro/escuro.
- Validar 1440×900, 768×1024 e 390×844. Fazer pelo menos um ciclo de correção após a observação real.
- Sem deploy ou mensagens reais. O usuário cuida do Dokploy. Não executar commit/push automaticamente por uma instrução deste plano; respeitar a autorização vigente na etapa de entrega.

## Review Focus

1. Mensagens sem referências, referências contraditórias ou pai ainda não importado não podem voltar ao agrupamento por assunto; teste na Tarefa 1.
2. Encaminhamento/recorrência não pode reutilizar a conversa de origem nem perder a autorização para seus anexos; teste na Tarefa 2.
3. Desligar/ligar filas rapidamente não permite que um job antigo sobrescreva o progresso da geração nova; teste na Tarefa 3.
4. DNS de subdomínio, DKIM sem seletor e ausência/timeout não podem virar um falso selo de domínio verificado; teste na Tarefa 5.
5. Acesso delegado, troca de empresa e retorno OAuth não podem vazar métricas nem deixar links ou caches do ambiente anterior; testes nas Tarefas 7 e 8.

## Ordem, checkpoints e mapa de arquivos

Bloco A (Tarefas 1–3): comportamento de e-mail e filas, testável sem painel. Bloco B (4–6): dados de domínios, diagnóstico e conexão de caixas, testável por API/componentes. Bloco C (7–9): painel, visão geral e navegação pessoal. Tarefa 10 integra e verifica a entrega. Os blocos pertencem ao mesmo plano porque compartilham sessão, permissões e contratos de caixas; não executar branches concorrentes.

Arquivos novos ficam junto à responsabilidade correspondente:

- `packages/shared/src/mail-policy.ts`, `domains.ts`, `admin.ts`: contratos e schemas puros; exportar em `index.ts`.
- `packages/db/src/domain/thread-identities.ts`, `mail-policy.ts`, `domains.ts`: persistência/regras, sem UI ou Fastify.
- `apps/api/src/modules/domains/`: `routes.ts`, `service.ts`, `dns.ts`, `dns-records.ts`; `modules/admin/overview.ts` e `queries.ts` para leitura administrativa.
- `apps/worker/src/handlers/refresh-tenant-queues.ts`: atualização empresarial em lotes.
- `apps/web/src/components/admin/`: layout, visão geral e telas de domínio; `lib/admin.ts`, `lib/domains.ts`, `lib/mailbox-groups.ts` para contratos de UI e consultas.
- Arquivos existentes de telas movidas são reutilizados; não reescrever formulário de equipe, quota, antivírus ou relatórios.
- Migrations propostas `0063_thread_identities.sql`, `0064_tenant_mail_policy.sql`, `0065_tenant_domains.sql`. Conferir o próximo número livre no início e ajustar somente nomes de migrations ainda não criadas/aplicadas se o repositório avançar.

Cada tarefa termina com testes pertinentes, `git diff --check` e revisão do diff. Não transformar cada pequeno controle em uma suíte própria.

### Tarefa 0: Conferir o ambiente de execução e marcar a base

**Files:** ler `AGENTS.md`, `package.json`, `apps/*/package.json`, `.env.example`, este plano e a spec. Modificar somente o status da spec para “aprovado”; não alterar seu conteúdo funcional.

**Interfaces:** produz ambiente de QA identificado e caminhos/portas válidos para as tarefas seguintes, sem exportar segredos em documentação.

- [ ] Conferir `git status --short`, branch, último commit, migrations existentes e processos em portas de desenvolvimento. Na preparação havia apenas a spec não rastreada; Node 24.21.0 e pnpm 12.8.1; portas 3018, 55433 e 63895 já estavam ocupadas por serviços locais. Não encerrá-los para liberar portas.
- [ ] Identificar Postgres/Redis de QA pelos recursos locais existentes e testar apenas conectividade. `DATABASE_URL_TEST` deve apontar para banco cujo nome termine em `_test`; Redis deve ser exclusivo de QA. Carregar configuração privada sem imprimir valores ou usar objetos completos de credenciais como saída.
- [ ] Selecionar portas livres para os novos processos ou reutilizar instância comprovadamente compatível. Segredos permanecem em variáveis de processo/arquivos ignorados. Criar fixtures próprias com IDs conhecidos e permitir limpeza apenas desses IDs.
- [ ] Registrar o hash de base e evidências não sensíveis em `.data/qa/admin-baseline.json` (ignorado pelo Git). Atualizar apenas o estado de aprovação da spec.

### Tarefa 1: Resolver conversas por identidade, inclusive recebimento fora de ordem

**Files:** criar `packages/db/migrations/0063_thread_identities.sql`, `packages/db/src/domain/thread-identities.ts`, `packages/db/test/integration/thread-identities.test.ts`; modificar `packages/db/src/domain/threads.ts`, `packages/db/src/index.ts`, `packages/db/src/types.ts`, `apps/worker/src/imap/ingest-message.ts`.

**Interfaces:**

- Ampliar `ThreadMessage` com `message_id_header: string`.
- Preservar `resolveThread(db: Database, msg: ThreadMessage, ourAddresses: string[]): Promise<string>` como entrada de recebimento; remover somente seu fallback assunto/participantes. `ourAddresses` continua necessário para os agregados.
- Criar `resolveIncomingThread(db: Database, msg: ThreadMessage): Promise<string>` em `thread-identities.ts`, chamado dentro da transação de ingestão.
- Criar `createIndependentThread(db: Database, msg: ThreadMessage): Promise<string>` para envios independentes na Tarefa 2.
- Tabela `thread_message_identities`: `tenant_id`, `mailbox_id`, `message_id_header`, `thread_id`, `observed`, `created_at`; chave única pelos três primeiros; FKs compostas asseguram empresa/caixa/conversa. Índice por conversa. Não migrar mensagens antigas para outra conversa nem preencher placeholders por assunto.
- A mesma migration 0063 já acrescenta `outbox.source_thread_id` nullable e FK composta por empresa/caixa. A Tarefa 2 passa a utilizá-lo sem editar uma migration aplicada. Criar as constraints únicas compostas referenciadas se ainda não existirem.

- [ ] Escrever testes de integração com banco real, usando o padrão de proteção de URL de `apps/api/test/integration/thread-operations.test.ts`. Casos: mensagem independente de mesmo assunto; resposta direta; referências sem pai local; filho antes do pai; dois filhos concorrentes; mesma identidade em pastas diferentes; cabeçalho igual em outra caixa/empresa; referência a conversa antiga; cadeia contraditória.

  Assertions centrais:

  ```ts
  expect(ids.sameSubjectNew).not.toBe(ids.original);
  expect(ids.reply).toBe(ids.original);
  expect(ids.childImportedFirst).toBe(ids.parentImportedLater);
  expect(ids.otherMailbox).not.toBe(ids.original);
  expect(oldMessage.thread_id).toBe(oldThreadId);
  ```

- [ ] Executar `corepack pnpm --filter @apmail/db exec vitest run test/integration/thread-identities.test.ts --no-file-parallelism`; confirmar falha pela regra atual ou ausência da nova tabela, não por conexão indisponível.
- [ ] Implementar a migration e a resolução com lock transacional por empresa/caixa. Identidade observada da própria mensagem mantém idempotência; pai direto conhecido tem prioridade; depois procurar ancestrais na ordem reversa de `References`. Se nada resolver, criar conversa e reservar identidades ainda desconhecidas dos ancestrais nela. A chegada posterior do original usa a reserva. Limitar a 50 referências validadas, sem usar assunto/data como prova.
- [ ] Consultar mensagens antigas pelo mesmo escopo antes de criar reservas, preservando seu vínculo. Se referências apontam para conversas diferentes, escolher a referência direta conhecida ou ancestral mais próximo; não unir conversas ou mover mensagens já persistidas. Reserva conflitante é registrada sem sobrescrever a identidade observada. Atualizar metadados de ingestão com o `header` já extraído.
- [ ] Aplicar migration no banco exclusivo de QA, gerar tipos com `corepack pnpm db:types` usando `DATABASE_URL` de QA e executar o teste novamente. Confirmar PASS e conferir que uma cópia enviada/duplicata não troca a conversa existente. Revisar diff e exportar somente helpers necessários.

### Tarefa 2: Respeitar a intenção de novo e-mail, resposta e encaminhamento

**Files:** consumir `outbox.source_thread_id` criado na Tarefa 1; modificar `apps/api/src/modules/outbox.ts`, `apps/worker/src/handlers/outbox-send.ts`, `apps/worker/src/outbox/build-mime.ts`, `packages/db/src/domain/recurring-outbox.ts`, `apps/web/src/components/mail/composer.tsx`, `apps/worker/src/handlers/rules-apply.ts` e `apps/worker/src/lib/queue-auto-reply.ts` somente onde transportam a origem; ampliar `apps/api/test/integration/composition-sent.test.ts`, `apps/worker/test/integration/mail-sync.test.ts`; criar `apps/worker/test/threading-outbox.test.ts`.

**Interfaces:**

- Consumir `createIndependentThread` e `ThreadMessage` da Tarefa 1.
- `outbox.thread_id` passa a representar a conversa de entrega, quando definida; `source_thread_id` representa somente a origem de encaminhamento/anexos. No payload atual de encaminhar, `thread_id` pode continuar chegando como origem, mas o adaptador deve persistir a separação. Replies preservam a conversa referenciada.
- Manter `outboxSchema.kind` e a URL pública da API. Devolver `source_thread_id` no contrato do rascunho e restaurá-lo no compositor. Revalidar origem por empresa, caixa, pasta e permissão de envio/leitura.

- [ ] Adicionar regressões de novo e-mail duas vezes com assunto/destinatário iguais; responder/responder a todos; encaminhar; salvar/reabrir rascunho; agendamento e recorrência; retry com mesmo Message-ID; anexo da origem sem autorização; resposta real após Concluir.
  ```ts
  expect(sent.newA.thread_id).not.toBe(sent.newB.thread_id);
  expect(sent.reply.thread_id).toBe(originThreadId);
  expect(sent.forward.thread_id).not.toBe(originThreadId);
  expect(forwardDraft.source_thread_id).toBe(originThreadId);
  expect(retry.thread_id).toBe(firstAttempt.thread_id);
  expect(reopened.queue_status).not.toBe('done');
  ```
- [ ] Executar os arquivos acima pelo pacote correspondente e confirmar que os casos novos falham com a implementação atual; os testes SMTP/IMAP usam GreenMail/Mailpit exclusivos ou dublês locais, nunca destinatários reais.
- [ ] No worker, `new` e `forward` criam conversa independente pelo helper da Tarefa 1, com Message-ID estável previamente persistido; não aceitar `row.thread_id` legado como prova de resposta. `reply` e `reply_all` derivam o vínculo da mensagem validada. As referências MIME existem somente nas respostas. A cópia IMAP reutiliza o Message-ID e a conversa persistida.
- [ ] Adaptar somente a origem dos forwards ainda não enviados (`draft`, `queued`, `scheduled`, `failed`), preservando status/corpo/anexos. Para registros legados, resolver `source_thread_id ?? thread_id` como origem na leitura e converter atomicamente antes do envio; novos registros já persistem os dois conceitos separados. Não reatribuir e-mails enviados. Os guards usam a origem para autorização e o novo ID para os agregados de entrega. Recorrências novas geram conversa nova por ocorrência; retries da mesma ocorrência permanecem idempotentes. Respostas automáticas e MDN conservam suas regras próprias, sem transformar encaminhamento em resposta.
- [ ] Repetir regressões com os tipos já gerados na Tarefa 1. Não editar migrations aplicadas: se precisar mudar o schema, criar a próxima migration livre. Revisar diff e confirmar manualmente o caso relatado de assunto igual com filas ocultas na Tarefa 10.

### Tarefa 3: Política de filas da empresa e reconciliação com progresso

**Files:** criar `packages/db/migrations/0064_tenant_mail_policy.sql`, `packages/shared/src/mail-policy.ts`, `packages/db/src/domain/mail-policy.ts`, `apps/worker/src/handlers/refresh-tenant-queues.ts`, `apps/api/test/integration/mail-policy.test.ts`; modificar `packages/shared/src/schemas/auth.ts`, `packages/shared/src/queues.ts`, exports/tipos dos pacotes, `apps/api/src/modules/tenants.ts`, `apps/api/src/modules/auth.ts`, `apps/api/src/modules/thread-operations/service.ts`, `packages/db/src/domain/thread-operations.ts`, `apps/api/src/modules/resources.ts` se necessário para enfileirar, `apps/worker/src/index.ts`, `apps/worker/src/handlers/ensure-schedulers.ts`, `apps/web/src/lib/auth.ts`, `components/settings/company-settings.tsx`, `components/layout/app-shell.tsx`, `components/mail/summary-navigation.tsx`, `components/mail/thread-workflow.tsx`, `routes/_app.mail-summary.tsx`, `routes/_app.mail.$mailboxId.tsx`, `routes/_app.dashboard.tsx`, `lib/search-params/mail.ts`; ampliar testes existentes de workflow/seleção/empresa.

**Interfaces:**

- `queuesEnabled(settings: unknown): boolean` no pacote shared: ler apenas boolean válido `mail_queues_enabled`, default `true`.
- `TenantQueueRefreshJob = { tenant_id: string; generation: string }`, job `maintenance` com nome `refresh-tenant-queues`.
- `requestTenantQueueRefresh(db: Database, tenantId: string): Promise<string>` cria geração persistida; `refreshTenantQueues(r: WorkerResources, job: TenantQueueRefreshJob): Promise<void>` processa lotes de 500 com cursor UUID e checkpoint.
- `tenant_mail_policy_runs`: uma linha por empresa, `generation`, `state` (`queued|running|succeeded|failed|superseded`), `after_thread_id`, `processed`, `started_at`, `updated_at`, `finished_at`, erro humano sanitizado. A tabela não recebe segredos.
- `/auth/me.tenants[]` passa a expor `mail_queues_enabled: boolean`; `useMailQueues()` lê apenas a empresa atual e retorna falso enquanto a sessão está carregando. Nenhuma dependência do campo pessoal legado.
- `GET /api/tenant/mail-policy-refresh` com `company.manage` retorna progresso. PATCH existente de empresa aceita a nova chave e emite `tenant:settings-changed` após salvar; API/backend verificam a política para ações manuais exclusivas de atendimento.

- [ ] Criar teste integrado que altera a política com proprietário, delegado e usuário negado; confirma que a classificação continua após recebimento/envio; notas/tarefas/agendamentos permanecem; mutação manual de atendimento retorna `409 mail_workflow_disabled` quando oculto. Testar desligar/ligar/desligar/ligar, retry de job e manutenção retomando checkpoint. Estado `done` e exclusões manuais não são apagados.
  ```ts
  expect(me.tenants[0].mail_queues_enabled).toBe(false);
  expect(internalThread.queue_status).toBe('to_reply');
  expect(manualDone.statusCode).toBe(409);
  expect(currentRun.generation).toBe(lastRequestedGeneration);
  expect(staleJobChangedRows).toBe(0);
  expect(assignmentNotificationsWhileHidden).toHaveLength(0);
  ```
- [ ] Rodar `corepack pnpm --filter @apmail/api exec vitest run test/integration/mail-policy.test.ts --no-file-parallelism`; confirmar falhas novas e conectividade real de QA.
- [ ] Implementar migration aditiva e política default verdadeiro. PATCH salva configuração/geração atomicamente; enfileiramento ocorre depois do commit e o agendador recupera gerações pendentes se o enqueue falhar. Job trava linha de geração a cada lote e abandona geração superada. Não alterar cálculos internos ou desligar workers; consumir `touchThreads` existente.
- [ ] Reativação enfileira uma geração; desligamento invalida a anterior. `tenant:settings-changed` invalida `me`, `tenant`, filas e Dashboard sem recriar sockets. Suprimir criação/exibição de notificações de atribuição/SLA enquanto oculto; notas com menção e tarefas continuam independentes. Não excluir notificações históricas do banco; filtrar as exclusivas de atendimento na listagem enquanto oculto.
- [ ] Implementar controle em Empresa → padrões de e-mail; ocultar todos os controles/contadores/filtros de atendimento via hook. Manter Resumo de entrada, agendamentos e tarefas. Normalizar deep links/filtros de filas para entrada. No Dashboard manter volume/pastas/e-mail e desativar consultas/cartões/links de filas, SLA e produtividade de atendimento quando oculto. Mostrar progresso da reativação apenas a quem pode consultá-lo.
- [ ] Reexecutar teste integrado e testes de `thread-workflow`, `mail-selection-actions`, `company-settings` e preferências; confirmar ausência de dependência do campo pessoal por `rg`. Revisar diff.

### Tarefa 4: Persistir domínios e vinculá-los às caixas sem alterar e-mails

**Files:** criar `packages/db/migrations/0065_tenant_domains.sql`, `packages/shared/src/domains.ts`, `packages/db/src/domain/domains.ts`, `apps/worker/src/handlers/backfill-mailbox-domains.ts`, `apps/api/src/modules/domains/routes.ts`, `apps/api/src/modules/domains/service.ts`, `apps/api/test/integration/domains.test.ts`, `packages/shared/src/domains.test.ts`; modificar exports/tipos, `packages/shared/src/access.ts`, `apps/api/src/authz/profile-access.ts`, `apps/api/src/app.ts`, `apps/api/src/modules/mailboxes.ts`, `apps/worker/src/index.ts`, `apps/worker/src/handlers/ensure-schedulers.ts` e bootstrap de perfis padrão existente.

**Interfaces:**

- `DomainOption = { id: string; domain: string; display_name: string }`; `TenantDomain` acrescenta `dkim_selector: string|null`, datas e `check: DomainDnsSnapshot|null` da Tarefa 5.
- `normalizeDomain(value: string): string` usa IDNA/validação compartilhada. `domainNameSchema`, `domainUpdateSchema` e query Zod: página/tamanho 10|20|30|50|100, busca e sort whitelist `domain|updated_at`.
- `ensureMailboxDomain(db: Database, tenantId: string, domain: string, actorId: string): Promise<DomainOption>` realiza upsert auditado em transação já autorizada, sem conceder edição avançada de domínio.
- `tenant_domains`: `id`, `tenant_id`, `domain` ASCII, `display_name` derivado, `dkim_selector`, `created_by`, `created_at`, `updated_at`; UNIQUE `(tenant_id,domain)` e `(tenant_id,id)`. `tenant_domain_checks`: snapshot único por domínio com tenant, estado, datas e JSON limitado. `mailboxes.domain_id` FK composta; não alterar endereço e aliases.
- A migration 0065 já cria `user_preferences.mail_group_by_domain boolean NOT NULL DEFAULT false`, consumido na Tarefa 9; não será necessário reabrir a migration.
- `backfillMailboxDomains(db: Database, after?: string): Promise<{after: string|null; linked: number; invalid: number; done: boolean}>` processa no máximo 500 caixas sem vínculo, normaliza IDNA pelo mesmo schema e registra inconsistências sem alterar os endereços. O handler `backfill-mailbox-domains` da fila maintenance retoma cursor persistido no payload, com três tentativas; o agendador recupera caixas pendentes. Nunca atualizar vínculos já preenchidos por edição humana.
- `/api/domains`: GET listagem/GET `/:id`, POST, PATCH `/:id`, DELETE `/:id`; `domains.view` para leitura, `domains.manage` para escrita. Nome em uso imutável; domínio com caixa não pode ser excluído.
- `/api/mailbox-domains`: GET opções/POST `{domain}` com `mailboxes.manage`, retornando somente `DomainOption`. Não contornar o guard com prefixos semelhantes.

- [ ] Escrever testes de normalização (IDNA, caixa, ponto terminal, URLs/portas/IP/wildcard inválidos), concorrência de cadastro, mesmo domínio em empresas distintas, FK cruzada, exclusão em uso e acesso mínimo pelo seletor. Snapshot de backfill compara IDs/endereço/status/credenciais antes e depois.
  ```ts
  expect(normalizeDomain(' APTechInfo.COM.BR. ')).toBe('aptechinfo.com.br');
  expect(secondTenantDomain.id).not.toBe(firstTenantDomain.id);
  expect(crossTenantLink.statusCode).toBe(404);
  expect(deleteUsedDomain.statusCode).toBe(409);
  expect(option).not.toHaveProperty('check');
  expect(afterMailbox.email_address).toBe(beforeMailbox.email_address);
  ```
- [ ] Rodar o teste shared e `corepack pnpm --filter @apmail/api exec vitest run test/integration/domains.test.ts --no-file-parallelism`; confirmar falhas esperadas.
- [ ] Implementar tabelas e backfill determinístico dos endereços ativos/existentes por empresa, inclusive domínios públicos e arquivos locais; não derivar de aliases. Domínios ASCII válidos seguem o backfill SQL; endereços IDNA legados não normalizáveis com segurança no SQL são resolvidos por `backfillMailboxDomains`, sem alterar seu endereço. Registrar quantidade de vínculos pendentes; não apagar registro inválido nem abortar toda migration por endereço legado. Impedir novos vínculos incoerentes na API e na integridade por tenant.
- [ ] Acrescentar permissões de domínio explicitamente a owner/admin padrão e bootstrap, mantendo customizações. Atualizar `hasAccess` legado para que as novas chaves sejam negadas por padrão a membros. Cadastro mínimo de domínio no fluxo de caixa usa o serviço sob `mailboxes.manage`. PATCH da caixa valida que a parte do endereço e o domínio vinculado coincidem; endereço e FK são atualizados juntos.
- [ ] Executar migrations e geração de tipos em QA, repetir testes e `packages/shared/src/access-granularity.test.ts`. Verificar que as caixas anteriores permanecem conectáveis e que a migration não consulta DNS nem serviços externos. Revisar diff.

### Tarefa 5: Diagnóstico DNS consultivo, limitado e sem falsos positivos

**Files:** criar `apps/api/src/modules/domains/dns.ts`, `apps/api/src/modules/domains/dns-records.ts`, `apps/api/test/domains-dns.test.ts`; ampliar contratos em `packages/shared/src/domains.ts`, rotas/serviço da Tarefa 4 e testes integrados; modificar `apps/api/package.json` e `pnpm-lock.yaml` para tornar `tldts@7.4.16` dependência direta do backend. A versão já existe transitivamente no lock; é necessária para determinar domínio organizacional de DMARC, sem cortar simplesmente as duas últimas partes do hostname.

**Interfaces:**

- `DnsRecordState = 'present'|'missing'|'invalid'|'error'|'not_checked'|'not_applicable'`.
- `DomainDnsSnapshot = { checked_at: string|null; records: {mx: DnsRecordResult; ns: DnsRecordResult; spf: DnsRecordResult; dmarc: DnsRecordResult; dkim: DnsRecordResult} }`.
- `DnsRecordResult = {state: DnsRecordState; queried_name: string; values: string[]; source_domain?: string; error_code?: 'timeout'|'not_found'|'resolver_error'|'response_limit'; message: string}`. `values` preserva prioridade MX em formato legível; diagnóstico não é um selo de validação.
- `inspectDomainDns(input: {domain: string; dkim_selector: string|null}, resolver?: DomainDnsResolver): Promise<DomainDnsSnapshot>`; injetar resolver nos testes. Resolver nativo com timeout de 2 s/tentativa única e cancelamento aos 8 s de orçamento total; concorrência máxima de quatro domínios por processo.
- `POST /api/domains/:id/check-dns` exige `domains.view`, máximo seis chamadas/minuto por usuário, intervalo mínimo 60 s por domínio e cache de 15 min; resposta indica `cached: boolean` e snapshot persistido. Falha atual não é apresentada como dado recente de sucesso.

- [ ] Escrever testes com resolver simulado para TXT fragmentado, SPF duplicado/malformado, null MX, domínio sem MX, NS ausente, timeout, DMARC do subdomínio versus herdado de `empresa.com.br`, DKIM sem seletor, chave revogada e CNAME do seletor. Verificar ausência de HTTP/TCP ao host encontrado.
  ```ts
  expect(noSelector.records.dkim.state).toBe('not_checked');
  expect(timeout.records.mx.error_code).toBe('timeout');
  expect(inherited.records.dmarc.source_domain).toBe('empresa.com.br');
  expect(noMx.records.mx.message).not.toContain('não recebe e-mails');
  expect(snapshot).not.toHaveProperty('ownership_verified');
  ```
- [ ] Rodar `corepack pnpm --filter @apmail/api exec vitest run test/domains-dns.test.ts`; confirmar falhas reais do recurso ausente. Promover a dependência com `corepack pnpm --filter @apmail/api add tldts@7.4.16` apenas ao executar esta tarefa, não durante planejamento.
- [ ] Implementar consultas MX/NS/TXT/_dmarc/seletor._domainkey, juntando fragmentos do mesmo TXT e distinguindo registros. Consultar o domínio organizacional para herança DMARC apenas quando o registro direto estiver ausente, não em timeout; usar Public Suffix List, sem inferência por remetente. Não inferir servidores IMAP/SMTP pelos MX nem prometer entregabilidade. Limitar resposta a 32 registros por tipo e 64 KiB por snapshot; ultrapassagem vira estado explícito.
- [ ] Implementar persistência/cache, lock de consulta concorrente por tenant/domínio, rate limit e auditoria da consulta manual. A tela lê o snapshot sem provocar nova consulta DNS em cada renderização. Permissão apenas de caixas não acessa diagnóstico. Falhas parciais mantêm os demais registros consultados.
- [ ] Repetir testes de DNS e integração de domínios para limite/cache/permissão. Confirmar que não há registro DNS alterado ou conexão a serviços do hostname. Revisar dependência e diff.

### Tarefa 6: Conectar caixas com parte inicial e domínio

**Files:** modificar `apps/web/src/components/forms/mailbox-wizard.tsx`, `apps/web/src/routes/_app.settings.mailboxes_.$mailboxId.tsx` (ou componente extraído deste arquivo), `apps/web/src/lib/auth.ts`, `packages/shared/src/schemas/auth.ts`, `apps/api/src/modules/mailboxes.ts`; criar `apps/web/src/components/forms/mailbox-address-fields.tsx`, `apps/web/src/lib/domains.ts`, `apps/web/src/components/forms/mailbox-address-fields.test.tsx`; ampliar integração `domains.test.ts`.

**Interfaces:**

- `MailboxAddressFields({value, domains, onChange, onCreateDomain, disabled}: Props)` trabalha com `{local_part: string; domain_id: string|null}`; o resultado expõe prévia do endereço, não senha de administração.
- `domainOptionsQuery(tenantId: string)` usa `/mailbox-domains`; `createMailboxDomain(domain: string): Promise<DomainOption>` usa a rota mínima da Tarefa 4.
- Entrada de caixa passa a aceitar `domain_id` e `local_part` com compatibilidade de `email_address` completo para clientes existentes. Se ambos forem fornecidos, exigir consistência; o servidor deriva o endereço final. `Mailbox` expõe `domain_id`/`domain` normalizado apenas como metadados da caixa autorizada.

- [ ] Testar seleção de domínio + parte inicial, prévia, domínio novo inline sem permissão avançada, falha de cadastro sem perder valores, endereço inconsistente no backend, fluxo de Gmail e arquivo local. Conferir campo Usuário do servidor editável: não assumir que é sempre igual ao e-mail.
  ```ts
  expect(screen.getByText('gabriel.teixeira@aptechinfo.com.br')).toBeVisible();
  expect(submitted.local_part).toBe('gabriel.teixeira');
  expect(mismatchedAddress.statusCode).toBe(400);
  expect(savedMailbox.domain_id).toBe(selectedDomainId);
  ```
- [ ] Executar teste de componente e a integração de domínios; confirmar falhas novas antes de mudar o formulário.
- [ ] Implementar os campos usando Label/Input/Select/Dialog existentes e React Hook Form/Zod, preservando os passos e validação real IMAP/POP3/SMTP. Escolha/adição de domínio não promete criar conta no provedor. Pré-preencher edição pela caixa atual; migrar também o fluxo do superadmin que chama o mesmo wizard, mantendo seu guard e seletor de empresa explícita, sem abrir endpoint de tenant para plataforma indiscriminadamente.
- [ ] Garantir adaptador de compatibilidade para API antiga e endereços legados pendentes de vínculo; sincronização/credenciais nunca dependem do sucesso do diagnóstico DNS. Aliases continuam sendo endereços completos independentes do grupo da caixa.
- [ ] Rodar regressões do formulário, `composition-sent` e `mailbox-drafts` se seus contratos de caixa mudaram. Revisar diff e mensagens de erro humanas.

### Tarefa 7: Navegação administrativa, menu da foto e rotas antigas

**Files:** criar `apps/web/src/components/admin/admin-navigation.tsx`, `admin-shell.tsx`, `profile-menu.tsx`, `apps/web/src/lib/admin.ts`, `apps/web/src/lib/admin.test.ts`, `apps/web/src/components/admin/profile-menu.test.tsx` e rotas canônicas abaixo; modificar `components/layout/app-shell.tsx`, `lib/settings.ts`, `packages/shared/src/access.ts`, rotas legadas movidas, links internos, `apps/api/src/modules/google/routes.ts`, gerando `routeTree.gen.ts` pelo plugin existente.

**Interfaces:**

- `administrativeSections(identity: AccessIdentity): AdminSection[]` e `canAccessAdmin(identity: AccessIdentity): boolean`, usando as permissões da spec e capacidades legadas normalizadas. Nenhum papel de administração é criado.
- `requireAdminSection(permission: AccessPermission): Promise<Me>` em `lib/admin.ts`, usando sessão e guard por seção. O layout não substitui guard de página.
- `ProfileMenu` contém “Painel Administrativo” quando permitido e “Meu perfil” abaixo, com logout compatível. Menu teclado/Radix existentes, sem depender de hover.
- Rotas: `_app.admin.tsx` (layout), `_app.admin.index.tsx`, `_app.admin.domains.index.tsx`, `_app.admin.domains.$domainId.tsx`, `_app.admin.mailboxes.index.tsx`, `_app.admin.mailboxes.$mailboxId.tsx`, `_app.admin.users.tsx`, `_app.admin.access-profiles.tsx`, `_app.admin.user-permissions.tsx`, `_app.admin.company.tsx`, `_app.admin.integrations.tsx`, `_app.admin.audit.tsx`, `_app.admin.security.antivirus.tsx`, `_app.admin.reports.tsx`, `_app.admin.reports_.meet.tsx`, `_app.admin.reports_.meet_.$meetingId.tsx`. Ajustar convenções de ponto/underscore ao gerador atual, preservando os caminhos canônicos definidos na spec.

- [ ] Testar menu para admin, delegado apenas a auditoria, pessoa sem seção e membro com permissões legadas. Testar matriz completa de redirecionamento, busca/ID preservados, abertura direta de seção negada e `/dashboard` permanecendo operacional.
  ```ts
  expect(paths(auditOnly)).toEqual(['/admin/audit']);
  expect(canAccessAdmin(noSections)).toBe(false);
  expect(legacyTarget('/reports/meet/abc?period=30')).toBe('/admin/reports/meet/abc?period=30');
  expect(screen.getByRole('menuitem', { name: 'Meu perfil' })).toBeVisible();
  ```
- [ ] Rodar `corepack pnpm --filter @apmail/web exec vitest run src/lib/admin.test.ts src/components/admin/profile-menu.test.tsx`; confirmar falhas de navegação ausente, sem testar marcação idêntica à implementação.
- [ ] Extrair navegação de e-mail e administrativa em componentes focados. `AppShell` mantém uma única sessão, troca de empresa, socket e transferências; escolhe sidebar pelo caminho `/admin`. `AdminShell` compõe título/contexto/Outlet, sem um segundo AppShell. Reutilizar componentes de dados atuais; extrair somente componentes embutidos em rotas que precisem de reuso.
- [ ] Trocar as rotas antigas por redirects TanStack com `replace` e parâmetros validados. Atualizar todos os links/notifications públicos pertinentes. No Google, manter `/api/integrations/google/callback` e preservar validação de state/PKCE; destino interno passa a `/admin/integrations?google=...`. Integração continua da pessoa atual; relatórios continuam obedecendo acesso atual.
- [ ] Atualizar `screenPermission` para prefixos novos antes de prefixos genéricos. Proteger a entrada e as páginas novas; ajustar `routePermission` das APIs novas sem liberar endpoints desconhecidos. Preservar `/superadmin` e seu fluxo. Trocar empresa/removeQueries segue a lógica atual; revogação deve retirar a seção sem criar loop de redirects.
- [ ] Reexecutar testes de navegação, `src/lib/settings.test.ts`, permissões shared e integração `google.test.ts` para retorno e isolamento. Confirmar geração de rotas por typecheck/build e revisar diff. Sem snapshots visuais artificiais nesta tarefa.

### Tarefa 8: Visão geral administrativa e telas de domínio

**Files:** criar `apps/api/src/modules/admin/overview.ts`, `queries.ts`, `apps/api/test/integration/admin-overview.test.ts`; criar `apps/web/src/components/admin/admin-overview.tsx`, `domain-list.tsx`, `domain-detail.tsx`, `domain-form.tsx`, `dns-record-status.tsx`, `admin-overview.test.tsx`; modificar `apps/api/src/app.ts`, `authz/profile-access.ts`, `packages/shared/src/admin.ts`, exports e rotas da Tarefa 7. Extrair leituras já existentes de quota/antivírus somente para permitir chamada de serviço, sem reescrever seu comportamento.

**Interfaces:**

- `AdminOverview = {generated_at: string; sections: Partial<Record<AdminOverviewSection, AdminOverviewBlock>>}`, seções `domains|mailboxes|storage|team|security|audit|mail_policy|integrations|reports`. Cada bloco: `state: 'ready'|'error'`, `observed_at: string|null`, `scope: 'tenant'|'authorized_mailboxes'|'personal'`, dados tipados por discriminante. O payload não contém blocos negados.
- Definir `AdminOverviewDataMap` em shared: `domains: {total:number;attention:number;unchecked:number;stale:number}`; `mailboxes: {total:number;active:number;pending:number;error:number;disabled:number;local:number;issues:AdminAttentionItem[]}`; `storage: Omit<TenantQuota,'mailboxes'>`; `team: {active:number;disabled:number;pending_invitations:number}`; `security: {blocked:number;pending:number;error:number;unverified:number;health_stale:boolean}`; `audit: {events:{id:string;action:string;actor_name:string|null;created_at:string}[]}`; `mail_policy: {enabled:boolean;refresh_state:string|null}`; `integrations` e `reports`: `{href:string;label:string}[]` de atalhos autorizados, sem métricas globais. `AdminAttentionItem = {id:string;kind:'connection'|'sync';label:string;observed_at:string|null;href:string}`. Bloco ready tem `data: AdminOverviewDataMap[K]`, bloco error tem apenas `message:string` humano e nenhum zero fabricado.
- `readAdminOverview(r: Resources, ctx: RequestContext): Promise<AdminOverview>` e `GET /api/admin/overview`. O guard aceita quem tem ao menos uma seção, mas cada consulta é autorizada separadamente. Conexão Google/relatórios não vira total global.
- `adminOverviewQuery(tenantId: string)` em `lib/admin.ts`; atualizar por eventos pertinentes e polling de 60 s, sem rodar diagnóstico DNS no polling. Falha parcial apresenta retry do bloco/contexto e mantém dados úteis.
- Lista de domínios usa `ConfigurableTable` com paginação SQL, count, busca e ordenação whitelisted; `listKey='admin-domains'`. Detalhe traz estado DNS e caixas autorizadas, sem nomes/endereço de caixas negadas.

- [ ] Criar fixtures conhecidas com duas empresas e perfis apenas auditoria/relatórios/caixas/domínios. Asserir contagens corretas e ausência real de propriedades negadas. Testar arquivo local sem erro de conexão, cota de provedor parcial, falha DNS isolada e usuário de integração vendo apenas dados pessoais.
  ```ts
  expect(auditOnly.sections).not.toHaveProperty('storage');
  expect(reportsOnly.sections).not.toHaveProperty('team');
  expect(mailboxAdmin.sections.mailboxes.scope).toBe('authorized_mailboxes');
  expect(domainError.sections.storage.state).toBe('ready');
  expect(localArchive.connection_issue).toBe(false);
  ```
- [ ] Rodar `corepack pnpm --filter @apmail/api exec vitest run test/integration/admin-overview.test.ts --no-file-parallelism`; confirmar falhas esperadas do recurso ausente.
- [ ] Implementar consultas limitadas e parametrizadas. Reutilizar `visibleAuditQuery`, quotas locais/provedor e métricas do antivírus dentro dos guards existentes. Eventos recentes limitados a dez, sem corpo de mensagem, segredos ou nomes de anexos. Separar bytes APMail/provedor e cobertura; erro/ausência de informação não vira zero. Não consultar recursos globais do superadmin.
- [ ] Implementar visão geral com pendências acionáveis e blocos permitidos; usar listas/tabelas compactas em vez de quatro cartões decorativos iguais. “Requer atenção” só inclui dados de seções permitidas, data da observação e link autorizado. Sem nota fictícia de segurança.
- [ ] Implementar cadastro/listagem/detalhe de domínios usando componentes existentes: busca/filtros/paginação, estados, confirmar remoção sem caixa, mostrar retorno/horário DNS e consulta manual. Valores completos acessíveis por expansão/tooltip, status com texto e ícone, DKIM sem seletor e domínio não consultado explícitos. O formulário de DNS nunca exige TXT de propriedade.
- [ ] Rodar integração de overview/domínios e teste representativo de falha parcial da UI. Revalidar perfis sem permissão por URL/API e revisar diff.

### Tarefa 9: Preferência e agrupamento pessoal das caixas por domínio

**Files:** consumir a coluna de preferência já criada na Tarefa 4; modificar `packages/shared/src/schemas/auth.ts`, `apps/web/src/lib/auth.ts`, `apps/api/src/modules/auth.ts`, `apps/web/src/components/settings/preferences-settings.tsx`, `components/layout/app-shell.tsx`; criar `apps/web/src/lib/mailbox-groups.ts`, `mailbox-groups.test.ts`, `components/mail/domain-mailbox-navigation.tsx`, `domain-mailbox-navigation.test.tsx`; ampliar `preferences-settings.test.tsx`.

**Interfaces:**

- `user_preferences.mail_group_by_domain boolean NOT NULL DEFAULT false`.
- `groupMailboxesByDomain(boxes: readonly Mailbox[]): {domain: string; mailboxes: Mailbox[]}[]`; usar somente a lista de caixas autorizadas, domínio canônico vinculado ou derivado do endereço legado. Ordenação estável `pt-BR`, numeric true, por hostname completo; nunca usar domínio de remetentes ou aliases.
- `DomainMailboxNavigation({groups, onNavigate}: Props)` compõe `MailboxFolderNavigation` existente; chave de expansão `apmail-domain:<userId>:<tenantId>:<domain>`, autoexpansão do grupo ativo.

- [ ] Testar caixas de dois domínios, subdomínio separado, aliases sem duplicar caixa, duas pessoas/empresas com estado distinto e preferência persistida após recarga. Ativar/desativar sem trocar seleção da caixa; Resumo fica antes dos grupos.
  ```ts
  expect(groups.map((g) => g.domain)).toEqual(['aptechinfo.com.br', 'gmail.com']);
  expect(groups.flatMap((g) => g.mailboxes)).toHaveLength(authorizedBoxes.length);
  expect(preferencesAfterReload.mail_group_by_domain).toBe(true);
  expect(screen.getByRole('link', { name: /Caixas de entrada/ })).toBeVisible();
  ```
- [ ] Rodar testes de helper, navegação e preferências pelo pacote web; confirmar falha antes da implementação.
- [ ] Implementar schema/API/tipo e controle “Agrupar caixas por domínio” na aba E-mail. Seleção é salva no banco; apenas o recolhimento é local. Nova preferência não muda política da empresa ou a configuração pessoal do Resumo.
- [ ] Implementar a navegação preservando estados de pasta, drafts, menus e transferências atuais. Após revogação/troca de empresa, recompor grupos só com as caixas restantes; não buscar cadastro administrativo de domínios para renderizar sidebar.
- [ ] Rodar regressões e confirmar persistência com recarga no navegador na Tarefa 10. Revisar diff.

### Tarefa 10: Integração, QA visual focado e preparação da entrega

**Files:** atualizar `README.md`, `docs/ARQUITETURA.md` e `docs/DEPLOY.md` somente nas mudanças reais; registrar evidências em `.data/qa/admin-*` ignoradas pelo Git; marcar os passos concluídos neste plano. `.env.example` só muda se a implementação realmente introduzir variável necessária.

**Interfaces:** entrega testável com migrations versionadas, comandos reais e limitações documentadas. Nenhuma operação externa de produção é parte deste plano.

- [ ] Executar `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`. Executar os arquivos integrados alterados nos pacotes db/api/worker, com banco e Redis de QA confirmados. Se teste Python do worker depender de runtime ausente, resolver pelo runtime disponível ou registrar a limitação real; não declarar suíte aprovada só porque os testes TypeScript passaram.
- [ ] Verificar migrations em banco de QA com dados anteriores e, separadamente, base vazia de QA. Conferir persistência e integridade composta, tipos gerados e que reexecutar o migrator não altera dados. Não usar `db:reset` ou scripts de produção para preparar QA. Arquivos de teste mantêm guarda `_test`.
- [ ] Iniciar web/API/worker de desenvolvimento sem disputar processos locais existentes. Abrir navegador real e confirmar: avatar/painel/perfil/voltar; links antigos; delegado vendo só seção concedida; criar domínio e consultar DNS; conectar caixa com servidor de QA; agrupamento e Resumo; desligar/ligar filas; novo e-mail com assunto igual separado, resposta e resposta pós-conclusão preservadas. Reload confirma preferências e política. O teste OAuth usa resposta simulada local ou credencial autorizada sem alterar configuração externa.
- [ ] Conferir 1440×900, 768×1024 e 390×844, claro/escuro, em painel geral, domínios/detalhe/formulário, menu de perfil, navegação de caixas e configurações de fila. Nas telas apenas movidas, testar o fluxo principal e o layout compartilhado; não duplicar uma bateria extensa para cada componente inalterado.
- [ ] Inspecionar console, foco/teclado, um h1 por página, loading/erro/vazio/sem permissão, overflow e toque mobile. Capturar evidências, observar criticamente, corrigir ao menos os ajustes encontrados e repetir só os fluxos afetados. Não afirmar revisão visual se só houver screenshots gerados sem inspeção.
- [ ] Revisar diff completo, `git diff --check` e `git status --short`: sem segredos, outputs, builds ou mudanças alheias; autorização nas novas APIs; sem reparo automático de conversas antigas; sem callback externo alterado; nenhuma chamada a provedor de produção disparada pelos testes.
- [ ] Documentar quais migrations precisam ser aplicadas pelo deploy e como validar painel/filas após a atualização conjunta de web/API/worker. Fazer revisão final conforme skill de code review, corrigir achados relevantes e entregar somente resultados comprovados, pendências reais e localização do plano/spec. Não fazer deploy no Dokploy.

## Autorrevisão do plano

- Cobertura: navegação/permissões/compatibilidade (7), overview (8), domínios/modelo/DNS/caixas (4–6), agrupamento (9), filas/Resumo/Dashboard (3), conversas (1–2), QA/documentação/publicação (10).
- Contratos: domínio canônico é `domain`; preferência pessoal é `mail_group_by_domain`; política empresarial é `mail_queues_enabled`; job usa `tenant_id` e `generation`; callbacks externos não mudam.
- As cinco condições de Review Focus têm teste e tarefa dona. Nenhum teste exige e-mail real ou mutação do provedor.
- Migrations recebem todos os campos necessários às tarefas dependentes antes da primeira aplicação. Depois de aplicada, qualquer mudança de schema exige nova migration, inclusive durante o desenvolvimento.
- Próximo passo: revisão do plano pelo usuário, conforme writing-plans; depois execução direta com executing-plans. O desenho já está aprovado; não reabrir decisões resolvidas.

## Registro de execução — 28/10/2026

Blocos A, B e C implementados com testes e revisão independente. Os casos relacionados foram consolidados nas suítes existentes para evitar redundância. A revisão exigiu uma migration adicional 0066 para preservar a limpeza definitiva das caixas. O salvamento da política e a geração de atualização são transacionais. A origem de encaminhamentos é preservada no contrato da API e no compositor. As migrations 0063–0066 foram aplicadas em QA e em produção com backup verificado; 5.619 mensagens e 6 caixas preservadas, 2 domínios vinculados, sem deploy.

Validação: lint, typecheck e build; 117 testes shared, 80 de banco, 20 unitários da API, 58 unitários do worker, 190 da interface e 11 Python; 53 integrações da API, 52 do worker e 4 de identidades, mais 3 casos de atualização das filas na conferência final. Dois testes de exportação PST preexistentes dependentes de conversor externo ficaram ignorados. Navegador: 18 combinações de rota/viewport/tema, cadastro e DNS, política de filas, acesso delegado, conexão de caixa local por partes do endereço e navegação ao perfil. Testes externos de envio utilizam servidor SMTP local exclusivo. Não houve envio a destinatários reais ou alteração no provedor.
