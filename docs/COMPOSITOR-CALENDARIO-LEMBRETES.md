# Compositor, calendário e lembretes

Implementação local de 16/10/2026. API, worker e web devem ser atualizados juntos. Não houve publicação nem alteração do banco de produção.

## Composição

Janela com título e controles existentes, ribbon em três grupos (Mensagem, Inserir e Formatar texto), envio com menu de agendamento, remetente, destinatários compactos, Cc/Cco expansíveis e editor amplo. Os comandos usam o TipTap existente: fonte/tamanho/cor, destaque, formatação, alinhamento, listas, recuo, espaçamento, links, imagens, tabelas, limpar formatação e desfazer/refazer. Prioridade é persistida e enviada nos cabeçalhos MIME.

Mantidos rascunho automático, Ctrl+S, Ctrl+Enter, arrastar anexos, imagens incorporadas, assinaturas, seleção de conta, respostas/encaminhamentos, agendamento e recorrência do envio, MDN e sugestão de contatos somente depois do envio. Fechar preserva o rascunho; descartar exige confirmação. A preferência de confirmação de leitura continua independente da escolha na mensagem atual.

## Calendário e convites

Rotas `/calendar` e `/reminders` integradas à navegação. FullCalendar oferece dia, semana, semana de trabalho, mês e lista, seleção de horário, arraste e ajuste de duração. Eventos têm descrição, local, cor/categoria, privacidade, participantes dos contatos e fuso. Calendários são pessoais, isolados por empresa e usuário; não há compartilhamento público nem sincronização com serviços externos.

`packages/shared/src/calendar.ts` concentra schemas, expansão de recorrências e leitura/escrita ICS com ical.js. Recorrências diárias, semanais, mensais e anuais, intervalos, dias da semana, posição no mês, término e exceções usam RRULE. Alterar uma ocorrência conserva a série. O fuso IANA e VTIMEZONE incorporado preservam o horário local em transições de horário de verão; datas de dia inteiro usam término exclusivo. Conteúdo externo tem limites de tamanho, componentes, expansão e período consultado.

Convites usam iCalendar/iTIP/iMIP ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), [RFC 5546](https://www.rfc-editor.org/rfc/rfc5546), [RFC 6047](https://www.rfc-editor.org/rfc/rfc6047)): `text/calendar` real com METHOD REQUEST, REPLY e CANCEL, UID, DTSTAMP, SEQUENCE e PARTSTAT. PUBLISH pode ser adicionado como compromisso pessoal, inclusive sem organizador. O leitor reconhece o anexo na ingestão MIME e oferece aceitar/tentativa/recusar. Respostas exigem permissão de envio e identidade participante da própria caixa ou de seus aliases; remetente e organizador/participante precisam corresponder. URLs e alarmes do ICS recebido nunca são executados.

Eventos, respostas e respectivas saídas são persistidos na mesma transação. A fila existente envia o MIME e recupera trabalhos após falha de Redis. Respostas repetidas para a mesma versão não criam novos envios. UID, sequência do componente e data da resposta correlacionam alterações e respostas; a versão para concorrência da interface é independente da sequência iTIP da série. Uma exceção conserva sua própria sequência. Convites recebidos só atualizam eventos previamente adicionados; não criam compromissos automaticamente. A edição de conteúdo externo pertence ao organizador; preferências pessoais de lembrete/calendário/cor permanecem editáveis. Convites na saída são alterados pelo calendário, impedindo edição inconsistente pelo compositor comum.

## Persistência e processamento

Migrations incrementais `0035`–`0038` adicionam `calendars`, `calendar_events`, `reminders`, metadados ICS nas mensagens/saída e prioridade. Incluem FKs compostas de empresa/proprietário, unicidade por UID e ocorrência, índices de período e vencimento, série de lembretes e medição lógica de armazenamento. Tipos foram regenerados com kysely-codegen. As três tabelas privadas têm RLS habilitada sem acesso SQL direto para papéis sem política; o serviço Fastify existente usa conexão proprietária e aplica autenticação, empresa, usuário e permissões de caixa/pasta em cada rota, conforme a arquitetura atual.

`packages/db/src/domain/calendar.ts` contém a persistência e o processamento. A fila BullMQ `calendar-reminders` executa a cada 30 segundos no worker, independentemente do navegador. Locks `FOR UPDATE SKIP LOCKED`, chaves únicas e uma transação para notificação/estado evitam duplicações entre workers. Um cursor materializa lembretes de eventos por ocorrência. Lembretes independentes podem recorrer, ser editados, adiados, dispensados, concluídos ou ter a série interrompida. As notificações internas ficam no banco; socket e revalidação periódica atualizam a interface quando disponível. Notificações do navegador continuam sujeitas à permissão e disponibilidade do cliente.

Não há novas credenciais ou variáveis obrigatórias. São necessários PostgreSQL, Redis, API e worker existentes; convites exigem uma caixa SMTP ativa. Lembretes não exigem SMTP. Nenhum envio de teste usou destinatários ou servidores externos.

## Validação executada

- Testes unitários de schemas/ICS, DST, horários flutuantes, datas de dia inteiro, exceções, regras de recorrência e controles de recorrência.
- Integração com PostgreSQL/Redis: CRUD, versões concorrentes, isolamento entre usuários/empresas, respostas/atualizações/cancelamentos, duplicação e processamento de lembretes sem navegador.
- SMTP local real: MIME REQUEST/REPLY, ingestão de RSVP e resposta explícita. Regressão de contatos e MDN no mesmo pipeline; testes MIME de CANCEL.
- Navegador Edge/Playwright: compositor formatado com tabela/anexo/assinatura/prioridade, rascunho reaberto, envio antes da oferta de contato, agendamento, reunião com contato, edição, arraste, duração, cinco visualizações, lembrete disparado pelo worker, adiamento/recarregamento/conclusão e convite recebido com três respostas. Desktop 1440×900, tablet 768×1024, celular 390×844; temas claro e escuro, sem erros de console nos fluxos verificados.
- Lint, typecheck e build aprovados. Testes unitários: 164 casos JavaScript/TypeScript e 11 Python aprovados. Integração: 7 casos do banco, 90 da API e 38 do worker aprovados; dois casos opcionais do worker ignorados. Após a última correção de concorrência de RSVP, os sete casos do calendário e os onze de contatos/MDN/SMTP foram executados novamente e aprovados. Uma falha intermitente no teste antigo de paginação do chat passou na repetição isolada e na repetição completa da API.
- A revisão visual teve um ciclo de correções de densidade, mini-calendário, contraste, campos de recorrência e interação mobile, seguido de nova execução. Dezoito verificações funcionais agrupadas no navegador passaram sem erro de console.

Limites: não foi realizado teste ao vivo com contas Outlook/Gmail. Interoperabilidade é baseada nos padrões e nos testes MIME, sem promessa de sincronização externa. A suíte de sincronização IMAP depende do GreenMail na porta 3143; não pôde ser executada neste ambiente. A revisão automática bloqueou a preparação desse servidor local por política de execução, sem detalhar o motivo. As demais suítes de integração foram executadas separadamente.
