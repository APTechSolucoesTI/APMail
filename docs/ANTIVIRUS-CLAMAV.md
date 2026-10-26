# Proteção de anexos e central de segurança

## Funcionamento

**Segurança → Antivírus** é restrito a proprietários e administradores da empresa,
com autorização também na API. Apresenta saúde do serviço, versão do motor e das
assinaturas, data das definições, arquivos, ameaças/bloqueios e histórico paginado.
Busca por arquivo, ameaça, assunto ou caixa; reanálise individual e lotes limitados
a 10, 50, 100 ou 500 arquivos antigos/falhos. Consultar a tela não inicia varreduras.

Recebimento IMAP/POP3/importação e uploads persistem o arquivo como **pendente** e
publicam um trabalho BullMQ. O e-mail continua disponível; os bytes ficam inacessíveis
até resultado **verificado**. **Infectado** significa quarentena lógica, sem exclusão
automática. **Falha** permanece bloqueada e recebe novas tentativas com espera crescente.
Arquivos criptografados ou acima dos limites aparecem como bloqueio preventivo,
sem afirmar que contêm malware.

A proteção cobre download, prévia, imagens CID, imagens de assinatura, avatares,
encaminhamento, envio/reenvio/agendamento e exportação. Rascunhos continuam editáveis.
SMTP é verificado novamente no worker, mesmo que o arquivo tenha sido alterado
depois de agendar. URLs não publicam o diretório de armazenamento.

O resultado fica em `file_security`; `file_scan_history` preserva cada tentativa.
SHA-256 vincula o veredito aos bytes. Abrir a mensagem não executa ClamAV novamente;
liberar bytes valida a integridade local, sem nova análise antivírus. Mudanças no
arquivo revogam o resultado anterior. Geração/lease impedem que uma análise antiga
libere conteúdo substituído e evitam processamento simultâneo do mesmo arquivo.
Notificações persistentes alertam administradores sobre quarentena e falhas do serviço.

Uma varredura de recuperação roda a cada minuto. Se Redis falhar após receber o
e-mail, os registros persistentes permitem recuperar a análise. O worker usa
concorrência padrão 1 e limite global da fila de um trabalho por segundo. Não aumenta
a concorrência IMAP nem espera a análise para concluir a sincronização.

## Publicação pelo Dokploy

1. Publicar API, worker e web da mesma revisão, usando o migrador habitual.
   A migration aditiva **0056_attachment_antivirus.sql** cria os três registros de
   segurança, índices e constraints; preserva mensagens, contatos e arquivos.
   RLS está habilitado sem grants públicos: o acesso usa as conexões privadas
   existentes da API/worker, com isolamento por tenant e autorização no servidor.
2. O Compose conecta API e worker à rede externa **dokploy-network**, além da rede
   privada do APMail. Essa rede precisa existir. Em Docker local sem Dokploy,
   criar uma rede externa com esse nome ou adaptar o Compose à rede privada do scanner.
3. Reutilizar **apticket-antivirus:3310**, já instalado. Não publicar a porta nem
   montar os arquivos do APMail no scanner. Não é instalada outra instância.
4. Conferir a central: online, versões e definições recentes. Testar um upload
   sintético antes de iniciar lotes do histórico.
5. Usar **Verificar pendentes** em lotes para arquivos anteriores à integração.
   Arquivos legados sem veredito ficam bloqueados até a análise; não há liberação
   automática nem varredura integral do acervo durante a migration.

Configuração compartilhada pela API/worker (também em `.env.example`):

| Variável                           | Padrão               |
| ---------------------------------- | -------------------- |
| `CLAMAV_HOST`                      | `apticket-antivirus` |
| `CLAMAV_PORT`                      | `3310`               |
| `CLAMAV_MAX_SCAN_MB`               | `25` MiB             |
| `CLAMAV_SCAN_TIMEOUT_MS`           | `30000`              |
| `CLAMAV_CONNECT_TIMEOUT_MS`        | `3000`               |
| `CLAMAV_DEFINITIONS_MAX_AGE_HOURS` | `168`                |
| `CLAMAV_CONCURRENCY`               | `1`                  |

O protocolo ClamD não fornece autenticação/TLS: a rede privada é a fronteira de
confiança. A aplicação envia bytes por INSTREAM; aceita somente resposta exata
`stream: OK`. Respostas truncadas, inconclusivas, timeout, ausência de definições ou
definições com mais de 168 horas não liberam arquivos. O painel avisa após 48 horas
sem atualização. Atualizar definições/reiniciar o ClamAV continua sendo operação da
infraestrutura compartilhada, não um botão do APMail.

O serviço inspecionado em 26/10/2026 permite **25 MiB por arquivo/stream**, 100 MiB
de análise expandida e alerta para arquivos criptografados/limites de descompactação.
Anexos e contêineres MIME/PST/importações acima do limite ficam bloqueados para
download/exportação, mesmo que a importação das mensagens tenha terminado. Aumentar
apenas a variável do APMail não aumenta o limite do daemon. Uma política maior exige
dimensionamento e mudança coordenada no serviço compartilhado ou scanner separado.
Contêineres de importação pendentes/infectados/falhos são preservados na limpeza
automática; o processamento interno existente extrai mensagens e coloca cada anexo
sob a mesma proteção. A exclusão explícita autorizada pelo usuário continua disponível.

## Validação reproduzível

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Integrações usam `DATABASE_URL_TEST` e `REDIS_URL_TEST` exclusivos. O teste de
  migrations exige o nome `apmail_test` e reinicia somente esse banco de QA.
- Teste opcional contra ClamD real, sem escrever EICAR no disco:

  ```bash
  CLAMAV_TEST_HOST=apticket-antivirus CLAMAV_TEST_PORT=3310 \
    pnpm --filter @apmail/db exec vitest run test/integration/clamav-live.test.ts
  ```

O teste verifica PING/VERSION, conteúdo limpo e a assinatura inofensiva EICAR.
Sem `CLAMAV_TEST_HOST`, fica explicitamente ignorado. Os demais testes TCP exercitam
falhas de protocolo, limites e definições; integrações de banco/fila cobrem quarentena,
recuperação após falha de Redis, permissões e bloqueios de todos os caminhos de bytes.

Na validação desta entrega, o scanner compartilhado real respondeu **ClamAV 1.5.4**,
assinaturas **28164** e detectou **Eicar-Test-Signature**. O processador real gravou
quarentena/histórico no PostgreSQL de QA e preservou os 68 bytes em diretório temporário
isolado do servidor. A estação remove EICAR localmente; sua proteção não foi desativada.
O navegador foi validado com API, banco, fila e ClamAV reais, sem worker SMTP nem
envio externo: download seguro, bloqueio do infectado, histórico, reanálise e backfill.
Temas claro/escuro; 1440×900, 768×1024 e 390×844. A publicação e o banco de produção
não foram alterados por esses testes.

Resultados finais em 26/10/2026:

| Verificação                                | Resultado                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / build                   | Aprovados                                                                                                                        |
| Unitários shared / db / API / worker / web | 104 / 79 / 11 / 56 / 151 aprovados                                                                                               |
| Python do importador                       | 11 aprovados                                                                                                                     |
| Integrações API                            | 183 aprovadas                                                                                                                    |
| Integrações worker disponíveis             | 60 aprovadas; 2 do conversor PST ignoradas                                                                                       |
| Integrações banco/migrations               | 11 aprovadas                                                                                                                     |
| ClamD real, limpo e EICAR                  | Aprovado                                                                                                                         |
| Navegador                                  | Quarentena, envio bloqueado de anexo infectado, upload limpo, rascunho, busca, teclado, menu móvel e membro sem acesso aprovados |

A suíte externa `mail-sync.test.ts` não concluiu: não há Greenmail IMAP/SMTP de QA
nas portas configuradas. Os dois casos de conversão PST dependem do conversor
externo e também não foram executados. As integrações de ingestão IMAP/POP3/importação,
montagem MIME, regras, agendamento e bloqueio antes de SMTP foram exercitadas nas
demais suítes. Um timeout de 5 segundos no teste antigo de perfis, sob execução
concorrente, desapareceu ao repetir os 151 testes web sequencialmente, sem alterar
o teste nem a implementação de perfis.

Referências: [operação oficial do ClamD](https://docs.clamav.net/manual/Usage/Scanning.html)
e [protocolo na versão 1.5.4](https://github.com/Cisco-Talos/clamav/blob/clamav-1.5.4/docs/man/clamd.8.in).
