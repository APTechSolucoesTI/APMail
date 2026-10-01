# Decisões de implementação

| Data       | Fase | Decisão                                                                                                         | Motivo                                                                                                                                                                                        |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01/10/2026 | 0    | SPA React/Vite com nginx, sem TanStack Start e sem Supabase                                                     | Exceções explícitas D6, D10 e seção 18 do prompt.                                                                                                                                             |
| 01/10/2026 | 0    | Lista de e-mails com 50 registros e título h1 de 20 px                                                          | Exceções explícitas das seções 7.6 e 13.4.                                                                                                                                                    |
| 01/10/2026 | 0    | PostgreSQL e demais serviços exclusivos, projeto de desenvolvimento `apmail-next-dev`                           | O usuário autorizou prosseguir sem responder à escolha de banco; foi adotado o contêiner próprio da especificação. O banco `apmail` e os contêineres preexistentes são preservados.           |
| 01/10/2026 | 0    | Infra de testes no servidor via SSH; portas remotas 15432/16379/13025/13143/13465/13993/11025/18025             | Docker não está disponível no host Windows; portas padrão do servidor já estão ocupadas por outros projetos. Túneis SSH mapeiam essas portas para localhost.                                  |
| 01/10/2026 | 0    | TypeScript 7 para compilação; alias `typescript` aponta para `@typescript/typescript6` somente para ferramentas | [Orientação oficial](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). ESLint e codegen precisam da API JavaScript da versão 6. |
| 01/10/2026 | 0    | Compilação Node com `tsc`, sem tsup                                                                             | Permitido pela seção 5; TypeScript 7 não oferece a API usada pelo gerador de declarações do tsup.                                                                                             |
| 01/10/2026 | 0    | IDs BullMQ substituem `:` por `~` na fronteira Redis                                                            | A [API atual do BullMQ](https://docs.bullmq.io/guide/jobs/job-ids) proíbe `:` em IDs personalizados. O ID lógico do contrato será mantido no PostgreSQL.                                      |
| 01/10/2026 | 0    | Domínio e SMTP real permanecem pendentes de configuração                                                        | O usuário autorizou começar sem fornecer esses dados. Mailpit será usado para testes; a publicação de produção não poderá ser declarada validada sem configuração real.                       |

Não foram alterados serviços ou bancos de outros projetos.

O repositório remoto vazio exige um commit inicial sem arquivos para estabelecer a main antes da entrega da Fase 0. As fases seguintes usam merge `--no-ff` conforme a especificação.

Correção de acessibilidade na Fase 0: `primary` claro e `ring` claro usam `#137A98`. Os valores originais têm contraste de 4,20:1 no botão branco e 2,21:1 no foco sobre branco. O ajuste fornece 4,92:1 e resolve a divergência entre a paleta e a exigência AA. Tema e especificação visual foram atualizados juntos; as cores institucionais são preservadas.

Fase 8: a revisão encontrou os valores originais novamente no tema e restabeleceu o ajuste de contraste documentado acima. `muted-foreground` claro passa a `#626D80`, pois `#667085` sobre `muted` fornecia 4,47:1. Abas usam o token de texto secundário em vez de transparência. A exigência AA prevalece sobre os valores originais da paleta; tema e especificação foram corrigidos juntos.

Fase 8: a instrução AGENTS.md mais recente prevalece sobre a exceção da Fase 0 para paginação. A interface de e-mail começa com 10 registros; opções 10/20/30/50/100 e preferências existentes permanecem disponíveis. A API conserva o padrão 50 quando o cliente omite `page_size`.

Fase 8: permissões de pasta incluem descendentes e são verificadas novamente no servidor. Uma conversa com mensagens em várias pastas expõe somente mensagens, anexos e agregados legíveis. Nenhuma pasta selecionada nega a leitura; proprietários, administradores de empresa e administradores de caixa têm acesso integral. O worker revalida respostas e anexos originais antes do SMTP, mesmo quando a restrição mudou depois do agendamento. O fechamento de uma instância Socket.IO desconecta apenas seus sockets locais.

TanStack Table 9: `useTable` e `tableFeatures` substituem a API v8, conforme [guia oficial](https://tanstack.com/table/latest/docs/framework/react/guide/migrating). O comportamento e o contrato de ConfigurableTable são preservados.

Migrations normalizam CRLF para LF antes do checksum, preservando o mesmo SHA-256 em Windows e Linux; alterações no SQL continuam proibidas. Atributos Git fixam LF no repositório.

Node mínimo atualizado para 22.22.2, exigido pelas dependências estáveis atuais de lint e testes. API e worker usam armazenamento relativo à raiz do workspace para compartilhar os mesmos arquivos.

Consultas de domínio no SPA incluem a empresa atual na chave de cache. Alteração e reconexão de Socket.IO invalidam os dados acessíveis; cookies e associações são verificados novamente no servidor.

Fase 2: destinatários em JSONB usam serialização explícita com cast; arrays JavaScript do driver pg são arrays PostgreSQL. Movimentos otimistas limpam o UID no destino e preservam o UID de origem no payload para evitar colisões entre pastas. A confirmação IMAP fornece o novo UID.

Conversas na Lixeira permanecem visíveis pela pasta, com agregados de fila calculados apenas sobre mensagens fora de Lixeira/Spam. Isso resolve o conflito entre exclusão das filas e restauração pelo usuário.

GreenMail 2.1.0: removida a propriedade auth.disabled inteira, pois sua [presença desativa a autenticação mesmo com valor false](https://github.com/greenmail-mail-test/greenmail/blob/release-2.1.0/greenmail-core/src/main/java/com/icegreen/greenmail/configuration/PropertiesBasedGreenMailConfigurationBuilder.java). No desenvolvimento com host permitido, a pasta é fechada antes do logout para contornar listeners antigos do servidor ao testar exclusão e UIDVALIDITY.

Socket.IO usa o prefixo apmail:socket:<banco Redis> nos adaptadores e no emitter. [Pub/Sub do Redis atravessa bancos lógicos](https://redis.io/docs/latest/develop/pubsub/#database--scoping); o prefixo evita interferência entre desenvolvimento e testes.

Fase 3: índices de assinatura padrão incluem tenant_id para que a assinatura global de um usuário não afete outra empresa. FKs compostas protegem assinatura/criador, thread, mensagem original e envio na mesma empresa e caixa.

Jobs outbox usam outbox~<id>~<contador>, pois BullMQ proíbe dois-pontos no jobId. Falhas definitivas usam [UnrecoverableError](https://docs.bullmq.io/patterns/stop-retrying-jobs), substituindo job.discard removido da versão instalada. SMTP aceito com falha posterior de confirmação local exige verificação de Enviados antes de retry; o worker evita retentativa automática nesse caso para reduzir duplicação.

MIME usa [MailComposer](https://nodemailer.com/extras/mailcomposer) com envelope explícito, Bcc fora do cabeçalho e corpo final pronto pelo compositor. O worker nunca acrescenta uma assinatura compartilhada.

Testes IMAP/SMTP usam uma instância GreenMail exclusiva de QA. Isso impede que a exclusão de pastas dos testes interfira na sincronização e nos agendamentos do ambiente interativo. Limpeza de Redis usa FLUSHDB apenas no banco lógico 0 da instância exclusiva de desenvolvimento; nunca FLUSHALL. Watchdog recupera schedulers mesmo sem reconexão e o sweep também recria jobs futuros ausentes, preservando seu prazo.

Fase 4: mensagens guardam rules_inbox e rules_applied_at para preservar a origem e retomar regras após falha, mesmo quando o cursor IMAP já avançou ou uma ação anterior moveu a mensagem. Registros anteriores à migration são marcados como processados; a ação explícita de reaplicação continua disponível. Índice único por regra e mensagem evita repetir encaminhamentos; todos os destinos de uma regra são reunidos no mesmo envio. Pastas usam o delimiter informado pelo IMAP, mantendo IDs ao renomear a árvore.

Fase 4: o payload do job rules-apply usa rule_id/since_days e attempts=1 conforme o contrato da tabela 12.1. A referência em camelCase da seção 10.4 é tratada como pseudocódigo; o worker aceita o formato anterior apenas para drenar jobs criados durante a implementação. O consumidor desta fila tem concorrência 1.

Fase 5: salas Socket.IO usam join/leave com ack conforme o contrato; subscribe permanece como compatibilidade. A confirmação de entrada revalida os dados para recuperar eventos ocorridos entre a consulta inicial e a entrada na sala. O encerramento aguarda a limpeza de presença antes de fechar Redis. O heartbeat de outra aba do mesmo usuário é preservado ao fechar uma aba.

Fase 5: globs de exclusão dos testes unitários usam aspas nos scripts para impedir expansão pelo shell Linux. Testes de integração permanecem no comando próprio, com banco e GreenMail exclusivos de QA.

Fase 6: intervalos do dashboard são dias de calendário inclusivos no fuso do tenant, limitados a 366 dias para manter consultas e séries limitadas. Filas e SLA refletem o estado atual; volume e produtividade usam o período. A contagem de recebidos exclui automáticos e Spam conforme 13.7, incluindo mensagens na Lixeira. Produtividade preserva contribuições históricas de membros desativados; usuários ativos contam somente membros ativos. Cards de filas oferecem escolha da caixa quando o indicador reúne várias caixas. Exportação CSV inclui todos os usuários do período/caixa selecionados e neutraliza fórmulas em nomes.

Fase 7: o cursor do chat preserva os seis dígitos de microssegundos do PostgreSQL e desempata por ID, evitando saltos em mensagens inseridas no mesmo milissegundo. Envios usam client_id estável, inclusive nas retentativas; recarga da primeira página preserva mensagens locais pendentes ou com falha. Compartilhamentos guardam snapshot produzido no servidor, e abrir o e-mail exige autorização atual. Presença online usa registros por socket com TTL, preserva outras abas e aguarda operações pendentes antes de fechar Redis.

Fase 9: a instalação Dokploy usa banco e volumes próprios, segredos novos e somente loopback 8081 enquanto domínio e SMTP real não são informados. Proprietário criado com o e-mail administrativo fornecido; cadastro público desativado em seguida. Não foram importados usuários, caixas ou dados da demonstração. O teste completo usa stack e provedores separados; certificado de QA é confiado apenas pelo override de teste, sem desativar TLS em produção.

Fase 9: nginx estável Alpine, verificado na versão 1.30.5, executa como usuário nginx com temporários em /tmp. DNS interno é renovado para permitir reinício da API. O inicializador de tema é um arquivo externo porque a CSP permite scripts somente da própria origem. Backup diário pausa escritores, inclui snapshot Redis e chaves privadas e preserva agendamentos existentes; cópia externa e cofre requerem o destino operacional da equipe.
