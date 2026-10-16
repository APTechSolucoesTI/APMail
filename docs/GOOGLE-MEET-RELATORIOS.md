# Google Meet: integração, sincronização e relatórios

## Ativação

Atualize API, worker e web juntos e aplique as migrations `0043`–`0045` pelo fluxo normal de `pnpm db:migrate`. São aditivas: preservam e-mails, contatos e eventos. `0043` cria as preferências pessoais por organização, salas, vínculos com eventos, conferências, participantes, sessões, arquivos e trechos de transcrição; `0044` permite importar texto de notas; `0045` inclui a medição de armazenamento existente e FKs compostas de isolamento. Os tipos Kysely foram regenerados. O acesso é exclusivamente pelo backend autenticado; as novas tabelas têm RLS sem permissões SQL públicas, conforme a arquitetura Fastify existente.

Configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` **na API e no worker**, mantendo `CREDENTIALS_ENCRYPTION_KEY` e `APP_URL`. O Compose já passa essas variáveis aos dois serviços. `GOOGLE_MEET_SYNC_MINUTES=5` controla o intervalo mínimo de consulta (2–60 minutos); espaços antigos ficam sujeitos a intervalos maiores. Não há chaves no navegador.

No Google Cloud:

1. Ative **Google Meet REST API**. Ative Calendar API somente para a consulta opcional de agenda e Drive API somente para importar o conteúdo de notas.
2. Configure público, identificação e usuários de teste na Google Auth Platform. Aplicativos externos podem precisar de verificação; administradores Workspace podem precisar aprovar o aplicativo.
3. Crie um cliente OAuth **Aplicativo da Web**. Cadastre exatamente a URI exibida em Configurações → Integrações: `APP_URL` + `/api/integrations/google/callback`.
4. Conecte a conta, conceda os serviços desejados e use **Testar conexão**. Escolha o plano informado por você, a caixa associada e as preferências de novas reuniões.
5. Para importar relatórios, autorize explicitamente os dados de reuniões e ative a sincronização. A conexão básica continua criando salas mesmo sem essa autorização.

O assistente da própria tela apresenta essas etapas e copia a URI de retorno. O [guia Word anterior](GUIA-INTEGRACAO-GOOGLE.docx) cobre a conexão básica; este documento complementa os novos escopos e a configuração do worker.

## Escopos e capacidades

| Permissão                                      | Finalidade                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `openid`, `email`                              | Identificação da conta conectada                                                                     |
| `meetings.space.created`                       | Criar/configurar salas do aplicativo e consultar seus registros e arquivos autorizados               |
| `meetings.space.readonly` (opcional)           | Consultar e associar salas criadas fora do APMail, quando acessíveis à conta                         |
| `calendar.events.readonly` (opcional)          | Prévia de até 100 próximos eventos, sem escrita ou sincronização bidirecional                        |
| `drive.meet.readonly` (opcional, **restrito**) | Exportar como texto documentos de notas criados pelo Meet, sujeito à verificação adicional do Google |

Os nomes abreviados acima usam o prefixo `https://www.googleapis.com/auth/`. A importação de transcrições estruturadas **não exige Drive**. Gravações e documentos permanecem no Google; links de visualização/download são abertos no provedor, que continua verificando o acesso. Não há cópia dos vídeos ou proxy que contorne suas permissões.

O plano declarado não é inferido nem usado como bloqueio artificial. Consultas reais verificam conta, registros, participantes, arquivos e membros, quando há dados e consentimento. Sucesso em uma consulta não comprova licença para gerar arquivos. Uma resposta 403 genérica também não comprova limitação da assinatura. Permissão ausente, API desativada, quota temporária e credenciais que precisam ser reconectadas possuem tratamento distinto. Recursos automáticos são validados pelo Google na criação/alteração da sala, sujeitos a anfitrião elegível e políticas.

Google One Premium, Google AI Pro/Ultra e as edições Workspace têm direitos diferentes. A tabela compacta em Integrações aponta condições e fontes oficiais, sem equiparar uma assinatura pessoal a uma conta administradora Workspace.

## Agenda e funcionamento em segundo plano

O evento continua usando o envio automático de convites, modelo e assinatura existentes. Convites SMTP/ICS não criam automaticamente um evento no Google Agenda nem uma lista de entrada direta no Meet; conforme a política da sala, convidados podem precisar pedir acesso. A conta que envia o e-mail pode ser diferente da conta Google organizadora da sala. A preferência de caixa da integração é utilizada nos novos convites com Meet, sem substituir uma escolha manual. É possível criar a sala com opções individuais, colar/associar um link autorizado, consultar o relatório e gerenciar configurações/membros conforme os privilégios validados pelo Google. A origem local da sala não é utilizada como bloqueio artificial; contas sem a permissão necessária recebem a orientação devolvida pela integração.

A fila BullMQ `google-meet-sync` executa uma varredura por minuto. Cada consulta paginada é uma tarefa pequena, com chave idempotente por geração, lock Redis e até quatro tentativas com espera exponencial. Access tokens são renovados no servidor com serialização e permanecem cifrados. Há limite por lote de salas e intervalos maiores para espaços inativos; arquivos em processamento são consultados novamente. A aplicação funciona com o navegador fechado, desde que worker, Redis e banco estejam ativos.

Fluxo: sala → registros de conferência → participantes e sessões → metadados de gravações/transcrições/notas → trechos estruturados e, se autorizado, texto de notas. Os recursos são independentes. Reconexões e dispositivos simultâneos usam a união dos intervalos de participação. Um participante sem e-mail não é vinculado por similaridade de nome. Os contatos dos convidados conhecidos são resolvidos em lote.

Google Workspace Events API + Pub/Sub foi avaliada; esta entrega usa **consulta periódica**, aproveitando Redis/BullMQ e sem criar infraestrutura externa. Admin SDK Reports não foi integrado: logs administrativos de auditoria exigem privilégios e autorização próprios e não equivalem às sessões da Meet REST API. Não existe serviço adicional de IA autorizado para produzir resumos; as notas apresentadas vêm do Google.

## Relatórios e privacidade

Relatórios → Google Meet inclui filtros de período/fuso, conta, organizador, situação e arquivos, busca, ordenação, paginação e preferências de colunas. Indicadores separam conferências reais de agendamentos e mostram a cobertura da importação. Eventos passados sem registro não são apresentados como reuniões realizadas. Uma sala reutilizada pode ter várias conferências; o vínculo ao evento depende da coincidência de horário, sem presumir que todos os usos do link pertencem ao mesmo convite.

Detalhes: visão geral, convidados/contatos, participação e sessões, linha do tempo recuperada, gravações, pesquisa de transcrição, notas e origem/limitações técnicas. Exportações: PDF, CSV protegido contra fórmulas, impressão, relatórios de período/duração/arquivos, participação individual e transcrição TXT/WebVTT. Busca/paginação são aplicadas no backend. Exportações revalidam o proprietário, têm limite de frequência e não usam cache público. Períodos excessivos pedem um recorte menor, sem truncamento silencioso.

Os dados são pessoais por usuário **e** organização, inclusive entre administradores da mesma empresa. Consentimento, retenção (30–3650 dias), retirada de autorização e desconexão são persistentes. Retirar o consentimento remove os dados importados; páginas já em andamento rechecam a autorização ao terminar e limpam eventual escrita concorrente. Desconectar ou trocar a identidade Google remove o cache anterior; eventos, links, contatos e arquivos originais no Google permanecem.

Os registros e trechos estruturados geralmente expiram na API após cerca de 30 dias. Isso limita recuperações futuras; não altera a retenção dos dados que já foram importados legitimamente. Os textos e metadados importados consomem a cota de armazenamento existente da organização. O sistema não produz notas de desempenho ou produtividade individual. O responsável pela reunião deve informar os participantes conforme as regras de privacidade aplicáveis.

## Verificação e limitações reais

Os testes usam PostgreSQL/Redis locais e respostas controladas dos endpoints Google somente no ambiente de teste. Cobrem PKCE, reautorização, tokens cifrados/renovação, idempotência, paginação de todos os recursos, duração sem duplicidade, permissões entre usuários/empresas, quotas, consentimento revogado durante consulta, retenção e exportações. A interface foi exercitada em Edge/Playwright, nos temas claro/escuro e em 1440×900, 768×1024 e 390×844. PDFs foram renderizados para inspeção.

Nenhum cliente OAuth de produção ou conta Google real foi disponibilizado para esta validação. A ativação final exige as configurações e aprovações acima. Não houve envio externo de e-mail, deploy ou alteração de banco de produção. Interoperabilidade e disponibilidade de arquivos dependem das permissões, plano, políticas, processamento e retenção reais do Google.

Resultados executados nesta entrega:

| Verificação                                                              | Resultado                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Lint, tipos e build dos pacotes                                          | Aprovados                                                                                                                        |
| Testes unitários TypeScript/JavaScript                                   | 223 aprovados                                                                                                                    |
| Testes Python PFF                                                        | 11 aprovados                                                                                                                     |
| Integração da API                                                        | 106 aprovados                                                                                                                    |
| Integração do banco, incluindo migrations do zero                        | 7 aprovados                                                                                                                      |
| Integração do worker (e-mail inteligente, regras/agendamento e arquivos) | 39 aprovados; 2 testes PST dependentes de DLL não disponibilizada foram ignorados                                                |
| Edge/Playwright                                                          | 8 fluxos agrupados aprovados; três resoluções, temas claro/escuro, sem erros de console nem overflow da página                   |
| Exportações PDF                                                          | Relatórios individuais/consolidados/transcrição inspecionados; teste de 18 páginas preservou texto final, cabeçalhos e numeração |

A suíte completa de sincronização IMAP não foi executada, pois o servidor de teste esperado na porta 3143 não está disponível. Os testes de envio/recebimento controlados do worker usam servidores locais e não demonstram entrega em uma conta externa ou compatibilidade ao vivo com o Google.

## Referências oficiais

- [Meet REST API v2 e recursos](https://developers.google.com/workspace/meet/api/reference/rest/v2)
- [Autenticação e escopos](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
- [Arquivos de reuniões](https://developers.google.com/workspace/meet/api/guides/artifacts)
- [Capacidades e assinaturas](https://support.google.com/meet/answer/10459644)
- [Eventos de Meet e Pub/Sub](https://developers.google.com/workspace/events/guides/events-meet)
- [Exportação de documentos Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export)
- [Auditoria administrativa Meet](https://developers.google.com/workspace/admin/reports/v1/appendix/activity/meet)
