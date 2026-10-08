# POP3, caixas locais e backups de e-mail

Entrega local de 07/10/2026. Requer migration `0024_mail_archives_pop3.sql`, após as migrations anteriores, e API/web/worker da mesma versão. Commit e deploy pelo usuário.

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

Limites: **20 GiB por arquivo e 50 MiB por mensagem**. Upload por stream e processamento sequencial, sem carregar o backup inteiro em memória. Subprocesso PST/OST sem shell, máximo de 30 minutos por tentativa; arquivos grandes podem exigir retomada.

Prévia no servidor compara bytes com o restante da **empresa e da caixa**. Exceder qualquer cota bloqueia; projeção a partir de 90% mostra aviso. Criação, upload real e ingestão revalidam capacidade sob bloqueio transacional; tamanho recebido deve coincidir com o declarado.

Origem ocupa espaço até concluir; MIME/corpos/anexos/metadados convertidos também consomem capacidade. Arquivo que cabe pode pausar ao expandir. **Cursor confirmado na mesma transação que grava a mensagem**, sem pular registros após falha/crash. Fonte preservada até retomar/cancelar. Ampliação/redistribuição disponibiliza retomada, também acionável na interface. Agendador recupera trabalhos que ficaram sem execução.

Duplicados: hash MIME na mesma caixa e, quando disponível, Message-ID contra mensagens ativas. Não deduplica entre empresas/caixas distintas. Histórico segue a janela de filas de 0–90 dias; 0 mantém histórico sem fila. POP3 classifica normalmente mensagens recebidas após concluir sua primeira sincronização.

## Backup e liberação de espaço

Exportação nesta entrega: **MBOX** ou **EML em ZIP**, incluindo anexos disponíveis, por stream sem arquivo permanente no volume. ZIP agrupado por pasta; API aceita `folder_id` opcional. Não exporta mensagens já excluídas nem exclui conteúdo automaticamente.

**Não há escrita nativa de PST/OST nesta versão.** [libpff](https://github.com/libyal/libpff) fornece leitura desses formatos. A escolha de priorizar exportação MBOX/EML foi apresentada ao usuário e ainda aguarda resposta. ZIP/MBOX nunca recebem extensão PST/OST.

POP3 e EML/EMLX/MBOX preservam MIME disponível. PST/OST e mensagens IMAP antigas são reconstruídos com corpos/anexos armazenados. Conteúdo que não foi armazenado no APMail não é recuperado do provedor pela exportação. Conferir o download antes de excluir.

**Liberar conteúdo de e-mails já excluídos** exige confirmação e remove corpos/MIME/anexos de até 1.000 cópias POP3/locais/importadas por operação. Preserva anexos usados por rascunhos/envios, mensagens ativas e identificadores mínimos/chaves de origem que impedem novo download pelo POP3. Não limpa remotamente o IMAP.

Remoção física pendente conserva bytes contabilizados e é repetida pela manutenção. Cancelar conserva mensagens já gravadas e remove a origem. Uploads abandonados por 36 horas são encerrados; importações pausadas/falhas com origem recebida ficam disponíveis para retomar/cancelar.

## Armazenamento, acesso e publicação

- Origens: `mail-imports/<tenant>/<mailbox>/<import-id>.<ext>`.
- MIME: `mail-raw/<tenant>/<mailbox>/<message-id>.eml`.
- Anexos: `attachments/<tenant>/<mailbox>/<message-id>/<attachment-id>`.
- Catálogo/referências/consumo incluem bytes físicos e payload lógico, na empresa/caixa proprietária. Caminhos internos não aparecem na listagem.
- Permissão atual e isolamento são verificados no servidor. Leitura de mensagens/anexos respeita conversa/pasta. Auditoria registra criação, conclusão, exportação, cancelamento e limpeza; logs não recebem conteúdo/credenciais.

Dockerfile do worker usa Debian Bookworm em build/runtime e instala [python3-pypff](https://packages.debian.org/bookworm/python/python3-pypff). Inclui `apps/worker/scripts/read-pff.py`. Fora do Docker, instalar Python 3/pypff no mesmo ambiente do worker.

Nginx atualizado: upload máximo 20 GiB, timeout de uma hora e buffering de requisição desativado na rota específica. Exportação sem buffering e timeout ampliado. Conferir limites/timeouts dos proxies externos; API e worker precisam do mesmo volume de armazenamento. Não executar reset para publicar.

## Busca global

Deduplicação por categoria/ID no servidor e cliente. Homônimos com IDs diferentes continuam separados. Cliques passam pathname/query separadamente ao Router, preservando pasta, conversa, fila, busca e rascunho. Destinos externos são recusados; telas de destino revalidam autorização.
