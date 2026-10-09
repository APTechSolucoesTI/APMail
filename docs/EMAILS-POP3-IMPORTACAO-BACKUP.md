# POP3, caixas locais e backups de e-mail

Entrega local de 07/10/2026, com correção de uploads em 09/10/2026. Requer migrations `0024_mail_archives_pop3.sql` e `0025_archive_chunk_upload.sql`, após as migrations anteriores, e API/web/worker da mesma versão. Commit e deploy pelo usuário.

## Tipos de caixa

- **IMAP e SMTP:** sincronização existente. Backups ficam em pastas locais separadas, preservadas durante a atualização das pastas IMAP.
- **POP3 e SMTP:** recebimento periódico por UIDL/LIST/RETR, testando POP3 e SMTP antes de salvar. Sem DELE: mensagens permanecem no provedor. Pastas, movimentos, exclusões e cópia de Enviados são locais; envio por SMTP, sem APPEND IMAP.
- **Arquivo local:** consulta/histórico alimentados por backups, sem credenciais ou conexão com provedor. Não envia mensagens; o usuário pode escolher outra caixa conectada como remetente. Acessos e cotas do APMail continuam aplicáveis.

Protocolo definido na criação, imutável na edição. POP3 requer UIDL estável: mudar números/ordem de mensagens não provoca novo download. Credenciais criptografadas e TLS implícito ou STARTTLS obrigatório. Transporte inseguro continua restrito a hosts permitidos explicitamente no ambiente de desenvolvimento.

POP3 e arquivos locais exibem **Não aplicável** para cota do provedor; não consultam capacidade de domínio. Cotas do APMail permanecem ativas. Totais de provedor da empresa consideram somente caixas IMAP com quota individual disponível.

## Importação

No cadastro e em **Configurações → Caixas de e-mail → caixa → Importação e backup**, para proprietário/admin da empresa. Superadmin gerencia configuração/cotas sem acessar conteúdos ou backups.

| Entrada | Tratamento |
|---|---|
| PST / OST | libpff/pypff: reconstrução de MIME, pastas, cabeçalhos disponíveis, texto/HTML e anexos, incluindo CID |
| MBOX | Mensagens sequenciais, com separadores e escape mboxrd |
| EML | Mensagem MIME preservada |
| EMLX | MIME após o cabeçalho de tamanho; plist não importado |
| ZIP | EML/EMLX/MBOX e suas pastas internas; outros arquivos ignorados |

Somente e-mails, sem contatos/calendários/tarefas. Arquivos corrompidos, criptografados ou variantes PST/OST não suportadas podem falhar com diagnóstico na listagem. Extensão e assinatura são conferidas. ZIP recusa caminhos inválidos, links, senha, mais de 100.000 entradas ou expansão acima de 20 GiB.

Limites: **20 GiB por arquivo e 50 MiB por mensagem**. O navegador envia blocos de até **4 MiB**, com checkpoint de bytes confirmado no banco e contabilidade física por empresa/caixa. Não cria uma segunda cópia integral nem carrega o backup inteiro em memória. Respostas perdidas são resolvidas consultando o checkpoint; falhas temporárias têm até três tentativas. Interromper o envio preserva os blocos recebidos. Selecionar novamente o mesmo arquivo (nome, tamanho e SHA-256 dos primeiros/últimos 64 KiB) permite continuar, inclusive após recarregar a página. A mesma amostra é verificada no servidor ao concluir; trata-se de identificação para retomada, não de hash integral do backup. Cancelar a importação remove a origem parcial/completa. Upload abandonado expira após 36 horas sem atividade. API bloqueia ordem/tamanho incorretos e não inicia o worker antes de receber o arquivo completo.

Processamento sequencial. Subprocesso PST/OST sem shell, com limite de 30 minutos **sem produzir uma mensagem**, renovado a cada mensagem; não limita a duração total de um arquivo grande. A leitura do stdout acompanha o consumo pelo worker, com limite por linha/mensagem: não drena o conversor para uma fila crescente em memória quando o banco estiver mais lento. A montagem de linhas usa segmentos, sem copiar repetidamente todo o prefixo acumulado.

Após receber o arquivo inteiro, uma primeira leitura calcula a quantidade de mensagens e o tamanho real do MIME extraído/construído, sem gravar uma cópia descompactada no volume. A tela diferencia **Envio incompleto → Na fila → Analisando arquivo → Importando → Concluída/Pausada/Falha**, mostra os bytes recebidos, contagem durante a análise e progresso de processamento após conhecer o total. A análise exige uma leitura adicional do arquivo; em PST/OST, executa o conversor uma vez para analisar e outra para importar. Retomadas de processamento aproveitam a análise concluída.

**Arquivo original** é o contêiner recebido. **Mensagens extraídas** soma MIME, inclusive duplicados; não é uma promessa de consumo final nem reserva de quota. **Adicionado ao APMail** soma o crescimento real confirmado nas transações das mensagens, sob o bloqueio da empresa: MIME, corpos, anexos e metadados das mensagens/conversas. Exclui o arquivo original, os cadastros de pastas e a auditoria; esses dados também entram no consumo completo das barras. É um total histórico das mensagens importadas, sem recalcular exclusões posteriores. As barras mostram o consumo atual completo da caixa e empresa, incluindo a origem até a conclusão/cancelamento. Não é possível deduzir o tamanho extraído do PST apenas pelo tamanho do arquivo; só fica conhecido após sua análise. Os contadores não adicionam cobrança lógica e podem atualizar com a cota cheia.

**Gerenciar armazenamento**, na listagem de caixas e na importação, abre **Configurações → Empresa → Distribuição entre caixas**. O admin/proprietário escolhe distribuição automática ou personalizada em %, GB, GiB, MB e demais unidades. A plataforma define o limite da empresa; a soma das caixas não pode ultrapassá-lo.

Prévia no servidor compara bytes com o restante da **empresa e da caixa**. Exceder qualquer cota bloqueia; projeção a partir de 90% mostra aviso. Criação, upload real e ingestão revalidam capacidade sob bloqueio transacional; tamanho recebido deve coincidir com o declarado.

Origem ocupa espaço até concluir; MIME/corpos/anexos/metadados convertidos também consomem capacidade. Arquivo que cabe pode pausar ao expandir. **Cursor confirmado na mesma transação que grava a mensagem**, sem pular registros após falha/crash. Fonte preservada até retomar/cancelar. Ampliação/redistribuição disponibiliza retomada, também acionável na interface. Agendador recupera trabalhos que ficaram sem execução.

Duplicados: hash MIME na mesma caixa e, quando disponível, Message-ID contra mensagens ativas. Não deduplica entre empresas/caixas distintas. Histórico segue a janela de filas de 0–90 dias; 0 mantém histórico sem fila. POP3 classifica normalmente mensagens recebidas após concluir sua primeira sincronização.

## Backup e liberação de espaço

Exportação nesta entrega: **MBOX** ou **EML em ZIP**, incluindo anexos disponíveis, por stream sem arquivo permanente no volume. ZIP conserva caminhos de pastas; MBOX reúne mensagens em um único arquivo. API aceita `folder_id` opcional. Por padrão não inclui excluídas; `include_deleted=true`, usado no backup anterior à exclusão da caixa, inclui mensagens excluídas cujo conteúdo ainda existe. Conteúdo já eliminado não pode ser recuperado pelo backup. A exportação não exclui conteúdo automaticamente.

**Não há escrita nativa de PST/OST nesta versão.** O conversor baseado em [libpff](https://github.com/libyal/libpff) lê esses formatos; gerar PST exige uma integração de escrita diferente. MBOX e ZIP/EML podem ser reimportados diretamente no APMail. Para gerar PST de uma conta IMAP pelo Outlook, usar a [exportação de arquivo de dados da Microsoft](https://support.microsoft.com/en-us/outlook/export-emails-contacts-and-calendar-items-to-outlook-using-a-pst-file); esse arquivo contém os dados disponíveis no Outlook, não recupera conteúdo exclusivo do APMail. ZIP/MBOX nunca recebem extensão PST/OST.

POP3 e EML/EMLX/MBOX preservam MIME disponível. PST/OST e mensagens IMAP antigas são reconstruídos com corpos/anexos armazenados. Conteúdo que não foi armazenado no APMail não é recuperado do provedor pela exportação. Conferir o download antes de excluir.

**Liberar conteúdo de e-mails já excluídos** exige confirmação e remove corpos/MIME/anexos de até 1.000 cópias POP3/locais/importadas por operação. Preserva anexos usados por rascunhos/envios, mensagens ativas e identificadores mínimos/chaves de origem que impedem novo download pelo POP3. Não limpa remotamente o IMAP.

Remoção física pendente conserva bytes contabilizados e é repetida pela manutenção. Cancelar conserva mensagens já gravadas e remove a origem. Uploads são encerrados após 36 horas **sem novos blocos confirmados**, usando `updated_at`, em vez de limitar a idade total de um envio ativo. A limpeza revalida atividade/estado com o mesmo bloqueio transacional do uploader; não apaga o arquivo de um envio retomado entre a seleção e a remoção. Importações pausadas/falhas com origem recebida ficam disponíveis para retomar/cancelar.

### Excluir caixas e remover usuários

Em **Configurações → Caixas de e-mail → Mais ações → Excluir caixa e conteúdos**: primeira etapa explica o alcance e oferece MBOX/ZIP com todo o conteúdo local ainda disponível; segunda exige digitar o endereço exato e confirmar que conferiu o backup ou decidiu prosseguir sem ele. Nenhuma exclusão ocorre ao baixar o backup. O navegador não consegue comprovar que o usuário terminou/conferiu seu download: a confirmação é explícita.

A API exige admin/proprietário, confirmação e endereço correto. Bloqueia envios em andamento e anexos da caixa usados em envios de outras caixas. Após a solicitação, remove acesso/credenciais, cancela envios pendentes/importações e redistribui cotas automáticas. A manutenção aguarda o bloqueio da caixa e apaga mensagens, anexos, MIME, pastas, rascunhos/envios, regras, fontes de importação e arquivos atribuídos à caixa. Não apaga dados IMAP/POP3 no provedor nem contatos/etiquetas/arquivos de outras caixas. A caixa fica como identificação de auditoria, sem conteúdo recuperável; registros de auditoria e identificadores do catálogo permanecem. Falhas de remoção mantêm os bytes cobrados e a solicitação visível na listagem, com novas tentativas pelo agendador. Uma solicitação concluída desaparece dessa lista.

Em **Configurações → Equipe e acessos**, a lixeira oferece **Remover da empresa**. Remove da listagem e revoga os acessos àquela tenância; preserva conta, autoria, contatos privados e acessos a outras empresas. Vínculo fica `removed` para preservar integridade do histórico, sem acesso; novo convite permite retorno, apenas com as novas permissões escolhidas. Não permite remover a si mesmo nem, para admin comum, um proprietário. O último proprietário ativo continua protegido pelo banco.

## Armazenamento, acesso e publicação

- Origens: `mail-imports/<tenant>/<mailbox>/<import-id>.<ext>`.
- MIME: `mail-raw/<tenant>/<mailbox>/<message-id>.eml`.
- Anexos: `attachments/<tenant>/<mailbox>/<message-id>/<attachment-id>`.
- Catálogo/referências/consumo incluem bytes físicos e payload lógico, na empresa/caixa proprietária. Caminhos internos não aparecem na listagem.
- Permissão atual e isolamento são verificados no servidor. Leitura de mensagens/anexos respeita conversa/pasta. Auditoria registra criação, conclusão, exportação, cancelamento e limpeza; logs não recebem conteúdo/credenciais.

Dockerfile do worker usa Debian Bookworm em build/runtime e instala [python3-pypff](https://packages.debian.org/bookworm/python/python3-pypff). Inclui `apps/worker/scripts/read-pff.py`. Fora do Docker, instalar Python 3/pypff no mesmo ambiente do worker.

Nginx aceita PATCH em blocos e mantém POST por stream para clientes internos/anteriores (20 GiB, timeout de uma hora, sem buffering na rota específica). O fluxo do navegador evita enviar um arquivo inteiro acima dos limites por requisição de proxies como [Cloudflare](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/). Exportação sem buffering e timeout ampliado. API e worker precisam do mesmo volume de armazenamento. Aplicar as migrations 0025–0028 junto da nova API/web/worker, sem reset. Importações antigas concluídas/na fila recebem checkpoint completo; envios antigos que não chegaram ao servidor podem ser cancelados e iniciados novamente. Métricas de processamento de importações antigas não são reconstruídas retroativamente; aparecem após a análise/retomada compatível.

## Busca global

Deduplicação por categoria/ID no servidor e cliente. Homônimos com IDs diferentes continuam separados. Cliques passam pathname/query separadamente ao Router, preservando pasta, conversa, fila, busca e rascunho. Destinos externos são recusados; telas de destino revalidam autorização.
