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

TanStack Table 9: `useTable` e `tableFeatures` substituem a API v8, conforme [guia oficial](https://tanstack.com/table/latest/docs/framework/react/guide/migrating). O comportamento e o contrato de ConfigurableTable são preservados.

Migrations normalizam CRLF para LF antes do checksum, preservando o mesmo SHA-256 em Windows e Linux; alterações no SQL continuam proibidas. Atributos Git fixam LF no repositório.

Node mínimo atualizado para 22.22.2, exigido pelas dependências estáveis atuais de lint e testes. API e worker usam armazenamento relativo à raiz do workspace para compartilhar os mesmos arquivos.

Consultas de domínio no SPA incluem a empresa atual na chave de cache. Alteração e reconexão de Socket.IO invalidam os dados acessíveis; cookies e associações são verificados novamente no servidor.

Fase 2: destinatários em JSONB usam serialização explícita com cast; arrays JavaScript do driver pg são arrays PostgreSQL. Movimentos otimistas limpam o UID no destino e preservam o UID de origem no payload para evitar colisões entre pastas. A confirmação IMAP fornece o novo UID.

Conversas na Lixeira permanecem visíveis pela pasta, com agregados de fila calculados apenas sobre mensagens fora de Lixeira/Spam. Isso resolve o conflito entre exclusão das filas e restauração pelo usuário.

GreenMail 2.1.0: removida a propriedade auth.disabled inteira, pois sua [presença desativa a autenticação mesmo com valor false](https://github.com/greenmail-mail-test/greenmail/blob/release-2.1.0/greenmail-core/src/main/java/com/icegreen/greenmail/configuration/PropertiesBasedGreenMailConfigurationBuilder.java). No desenvolvimento com host permitido, a pasta é fechada antes do logout para contornar listeners antigos do servidor ao testar exclusão e UIDVALIDITY.

Socket.IO usa o prefixo apmail:socket:<banco Redis> nos adaptadores e no emitter. [Pub/Sub do Redis atravessa bancos lógicos](https://redis.io/docs/latest/develop/pubsub/#database--scoping); o prefixo evita interferência entre desenvolvimento e testes.
