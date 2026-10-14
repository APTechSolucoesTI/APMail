# Contatos inteligentes e confirmação de leitura

A implementação mantém React/TanStack Query/Router, Fastify, Kysely/PostgreSQL,
Redis/BullMQ e IMAP/POP3/SMTP. Não usa pixels de rastreamento.

## Contatos

`contact_emails` já suporta vários endereços por pessoa. A resolução compartilhada
faz uma consulta em lote por página/conversa, com comparação pelo endereço
cadastrado: espaços externos e caixa normalizados, sem remover pontos ou `+`.
Respeita empresa e agenda individual; em colisões preexistentes entre agenda
individual e global, o contato individual do usuário tem precedência explícita.
Nenhuma associação usa similaridade do nome.

Os nomes cadastrados são usados nas listas de entrada/enviados, mensagens,
busca global e destinatários. O endereço real permanece visível. A listagem
recebe os vínculos junto com os dados, evitando consultas por linha e badges
incorretos durante uma segunda carga.

`POST /api/contacts/:id/emails` acrescenta um endereço em transação, sem
reescrever os canais existentes. Valida visibilidade, limite, conflito e
duplicação, mantém principal e incrementa a versão da ficha. A trava por empresa
e o índice de unicidade da agenda serializam os cadastros concorrentes.
`POST /api/contacts/from-message` usa o schema e serviço existentes, incluindo o
modo de agenda definido pelo administrador. A UI permite corrigir nome,
empresa e cargo; a ficha completa continua disponível no cadastro de contatos.

O modal em etapas é compartilhado pelo leitor e pela sugestão pós-envio. A
invalidação de cache e o evento `directory:changed` atualizam mensagens antigas
e outras abas, sem recarregamento completo.

## Sugestão após SMTP

Somente mensagens com `status='sent'`, enviadas pelo usuário atual, ficam
elegíveis. Não há sugestão quando a mensagem está na fila, no período de
Desfazer, agendada, falhou ou foi cancelada. To/Cc/Bcc são normalizados e
deduplicados; os contatos são consultados em lote.

O endpoint de sugestão reclama cada envio uma vez com lock e `SKIP LOCKED`,
persistindo `contact_prompt_handled`. Recusa/cancelamento não repetem o modal
após recarregar. Envios anteriores à migration, mensagens automáticas e MDNs
não geram sugestões retroativas. Durante resolução de vários destinatários,
endereços já vinculados são pulados. O processamento de contatos não cancela,
refaz ou modifica o envio concluído. Novas janelas de composição e outros
diálogos adiam a apresentação da sugestão.

## MDN — RFC 8098

Referência: [RFC 8098](https://datatracker.ietf.org/doc/html/rfc8098).

- Composer e outbox persistem `request_read_receipt`. O MIME inclui
  `Disposition-Notification-To` com o endereço da caixa e um Message-ID estável.
- A preferência padrão é por usuário, em `user_preferences`, e vale para novos
  e-mails, respostas e encaminhamentos. Rascunhos mantêm a escolha já salva.
- A ingestão comum a IMAP, POP3 e importações identifica o pedido válido. Exige
  um endereço de retorno, Message-ID válido, ausência de loops/listas/newsgroups
  e nenhuma extensão obrigatória desconhecida. Pedidos inválidos são ignorados.
- Abrir/exibir a mensagem não envia nada. Confirmar exige permissão de envio;
  recusar exige leitura. O destino exato é mostrado, com informação adicional
  quando o Return-Path difere ou não pode ser verificado.
- Consentimento e outbox são gravados juntos. A chave empresa/caixa/Message-ID
  impede repetição entre usuários e cópias da mesma mensagem. A decisão de uma
  caixa compartilhada também é compartilhada por seus usuários autorizados.
- A resposta é `multipart/report; report-type=disposition-notification`, com
  parte humana e `message/disposition-notification`, `Reporting-UA`,
  `Final-Recipient`, `Original-Message-ID` e
  `Disposition: manual-action/MDN-sent-manually; displayed`. Envelope SMTP vazio,
  `Auto-Submitted: auto-replied` e nenhuma nova solicitação MDN.
- Falhas ou envios com resultado SMTP incerto não são repetidos automaticamente.
  O sweep sinaliza uma MDN interrompida como falha, evitando duplo envio após
  reinício. A decisão não é removida e o leitor mostra o estado.
- Recebimento exige o MIME apropriado, um bloco válido e Message-ID/destinatário
  compatíveis com uma mensagem enviada com solicitação na mesma empresa/caixa.
  A unicidade mensagem/destinatário/disposição torna o processamento idempotente.
  Apenas `displayed` produz “Leitura confirmada”; outras disposições não provam
  leitura. A interface exibe a hora local de recebimento e o destinatário.
- MDNs não são respostas de atendimento: não encerram SLA de primeira resposta,
  não alteram a fila para “aguardando resposta” e não aparecem como agendamentos.

MDN é uma declaração do cliente remoto, sem autenticação criptográfica inerente.
Não comprova compreensão, identidade humana ou entrega. Provedores podem ignorar
a solicitação, recusar envelope vazio ou não oferecer MDN; ausência de resposta
nunca indica mensagem não lida. Retornos sem associação inequívoca, múltiplos
endereços de retorno e extensões não suportadas são conservadoramente ignorados.
Não há coordenação de decisões com outros clientes externos da mesma caixa.

## Banco e atualização

Migrations aditivas `0032`–`0034`: metadados de solicitação, preferência,
`mdn_decisions`, `mdn_receipts`, índices de resolução/correlação/sugestão e
registro na medição de armazenamento. FKs compostas mantêm empresa/caixa; RLS
nas tabelas novas nega acesso SQL direto a papéis não proprietários. O browser
usa exclusivamente APIs autenticadas e autorizadas do Fastify; não existe uma
Data API de banco público nesta arquitetura. Os tipos Kysely foram gerados a
partir do banco local migrado, preservando os tipos existentes não relacionados.

Atualize API, worker e web juntos. `pnpm db:migrate` prepara o banco de
desenvolvimento; API/worker também aplicam migrations pendentes na inicialização
de produção, seguindo a operação existente. Esta entrega não faz deploy.

## Validação

Testes unitários em shared/worker validam normalização, fallback, preferência,
headers, MIME e pedidos inválidos. Testes de componentes validam modal,
criação/vinculação, cancelamento, erros e checkbox em novos/respostas/encaminhamentos.
`apps/worker/test/integration/intelligent-mail.test.ts` usa PostgreSQL/Redis
exclusivos de testes e servidor SMTP local, exercitando o transporte Nodemailer
real, isolamento, concorrência, persistência, consentimento, duplicações,
correlação e recuperação. Requer `DATABASE_URL_TEST` e `REDIS_URL_TEST` locais.

Para executar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`;
suítes de integração disponíveis em cada pacote. Testes de migrations que
recriam esquema devem usar somente uma instância descartável e o banco exclusivo
`apmail_test`, conforme as proteções já existentes.
