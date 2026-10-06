# Cotas de caixas e armazenamento

Entrega de 06/10/2026. Configuração de capacidade independente de planos comerciais. A publicação fica a cargo do operador; esta implementação não altera a produção.

## Configuração

No `/superadmin`, selecione uma empresa e abra **Empresa** ou **Armazenamento**. Em **Armazenamento e capacidade**, configure o máximo de caixas e o limite de armazenamento da empresa. Campos em branco significam ausência de limite; zero é um limite válido. Caixas desativadas continuam contando no cadastro; caixas excluídas deixam de ocupar uma vaga.

O proprietário ou administrador da empresa gerencia a distribuição em **Configurações → Empresa**. Membros, supervisores e administradores apenas de caixa não podem alterar essa distribuição. O superadmin configura os limites globais e consulta o consumo, mantendo a restrição de acesso ao conteúdo dos e-mails.

- **Automática:** divide todos os bytes da cota entre caixas não excluídas, incluindo as desativadas. Recalcula ao adicionar/remover/restaurar caixas. O resto da divisão é atribuído em ordem estável de criação/ID; a soma nunca supera a cota.
- **Personalizada:** aceita percentuais da cota da empresa ou quantidades em B, KB, MB, GB, TB, KiB, MiB, GiB e TiB. A soma pode ser menor que a cota; novas caixas recebem todo o saldo ainda não distribuído. Sem saldo, a criação é bloqueada até redistribuir.
- Alterar unidades preserva a quantidade de bytes. GB é decimal e GiB é binário. Percentuais aceitam quatro casas decimais e arredondam a quantidade para baixo até bytes inteiros.
- Reduzir limites não exclui dados existentes. Uma cota global menor que a distribuição manual exige redistribuição prévia. Retornar a armazenamento ilimitado também retorna ao modo automático.
- Dados compartilhados e de caixas excluídas ainda retidos consomem a cota global. Distribuir 100% entre caixas não reserva capacidade adicional para esses dados.

## Medição e bloqueio

A referência é a mesma atribuição descrita em [OPERACAO-ARMAZENAMENTO.md](OPERACAO-ARMAZENAMENTO.md): payload lógico canônico + bytes de arquivos presentes, deduplicados por identidade física. Não rateia PostgreSQL físico, índices, WAL ou Redis. Dados com exclusão lógica continuam consumindo até a remoção efetiva.

As barras usam a projeção transacional e o inventário atual, sem esperar a próxima publicação de snapshots históricos. O consolidado da empresa é lido em transação com snapshot consistente. Valores de bytes circulam como strings decimais; cálculos de capacidade usam `BigInt`/`bigint`.

Admissão de conteúdo e mudança de cota serializam por empresa no banco. Mensagens, anexos, rascunhos, uploads, assinaturas, contatos, notas, chat e regras verificam crescimento de payload. Gravações/cópias de arquivos verificam capacidade antes de publicar, incluindo streams. Uploads novos do compositor são atribuídos à caixa de envio e não podem ser reutilizados em outra caixa. Cadastros simultâneos não podem superar o máximo de caixas.

Leitura, exclusão, configurações administrativas, auditoria e alterações técnicas de estado permanecem disponíveis quando a cota está cheia. Seus metadados reais continuam sendo medidos; uma atualização operacional pode acrescentar bytes de controle além da cota. O sistema não oculta esses bytes. Novas importações e envios verificam também o total final da transação, incluindo agregados da conversa.

Na importação, corpo, anexos e agregados são revertidos juntos se a mensagem não couber. No envio, a cópia local completa é preparada e validada **antes** do SMTP; falha de cota não entrega a mensagem e fica em **Envios → Falhas**, disponível para nova tentativa após liberar capacidade. O lock da empresa é mantido durante a entrega SMTP para impedir que outro processo consuma a capacidade admitida. Uma falha de confirmação após o SMTP continua exigindo conferência em Enviados antes de repetir, conforme a proteção já existente.

Banco e filesystem não formam uma transação distribuída. Falhas normais removem os arquivos preparados; queda abrupta pode deixar arquivos órfãos, que o inventário identifica pelo caminho da empresa/caixa. Preserve a reconciliação periódica. Ao atualizar uma instalação legada, conclua a conferência inicial antes de configurar limites finitos; a API recusa essa configuração se houver arquivos da empresa ainda pendentes de observação.

## Checkpoint e retomada

Ao faltar capacidade, a caixa permanece ativa e a importação pausa. `mailbox_storage_limits.sync_checkpoint` registra pasta, `UIDVALIDITY`, último UID confirmado, primeiro UID ainda não importado, motivo e valores de consumo/cota. `folders.last_uid` nunca ultrapassa a primeira falha; não há perda de e-mail por avanço do cursor.

O agendador continua existindo. Enquanto os limites/consumo não mudarem, evita repetir a importação bloqueada. Ampliação de cota, redistribuição ou remoção efetiva de dados provoca reavaliação; mudanças pelos endpoints de configuração também enfileiram sincronização imediatamente. A importação retoma pelos cursores das pastas e usa a deduplicação existente. Se a próxima mensagem ainda não couber, a pausa é atualizada. Mudanças de `UIDVALIDITY` são tratadas pelo fluxo normal quando a sincronização retoma. Caixas desativadas e empresas suspensas não são reativadas automaticamente.

As barras aparecem em **Configurações → Caixas de e-mail**, além do consolidado da Empresa e da gestão no superadmin. Na tela de e-mails aparecem somente avisos: consumo a partir de 90% do limite, limite atingido ou sincronização pausada. Abaixo desses estados, nenhum painel de armazenamento ocupa a tela. Eventos de pausa/retomada invalidam o consumo na interface; a consulta também é renovada a cada minuto.

## Cota do provedor

A consulta é somente leitura, por IMAP `GETQUOTAROOT`/`GETQUOTA` de `INBOX`, na conexão inicial e durante sincronizações, com intervalo mínimo de 15 minutos. Não executa `SETQUOTA` nem altera o provedor. O recurso STORAGE é definido em unidades de 1024 bytes no [RFC 9208](https://www.rfc-editor.org/rfc/rfc9208.html). O adaptador lê os inteiros do protocolo com `BigInt` e converte uma única vez para bytes, sem perda de precisão até o limite de bigint do PostgreSQL.

Um servidor pode informar várias raízes para a mesma conta, como usuário e domínio, conforme a [documentação do Dovecot](https://doc.dovecot.org/main/core/plugins/quota.html). O `getQuota` do ImapFlow 2.2.1 combina os recursos dessas respostas; o adaptador do APMail mantém cada raiz separada e consulta somente a individual escolhida. A ordem das respostas não altera os valores exibidos.

Como o protocolo não padroniza o significado dos nomes, a seleção é conservadora: aceita uma única raiz identificada pelo login, `#user/<login>`, `user/<login>` ou pelas convenções `User quota`, `Mailbox quota`, `Personal quota` (também sem o sufixo). Raiz vazia é aceita somente nos hosts conhecidos `imap.gmail.com` e `outlook.office365.com`. Raízes de domínio, hospedagem ou compartilhamento, nomes opacos e múltiplas raízes individuais concorrentes ficam indisponíveis. Esses nomes são convenções, não uma comprovação padronizada de escopo. Se o servidor disponibilizar apenas o limite compartilhado, obter a capacidade individual exige que o provedor publique a cota da conta ou ofereça uma API específica; não se divide o limite do domínio pela quantidade de caixas.

Exibe estados distintos: pendente, disponível, cota individual não identificável e erro. Capacidade zero é preservada; valores inválidos ou acima do limite bigint são recusados. Falha da consulta limpa a amostra anterior para evitar uso de valores antigos, sem transformar a caixa em erro de conexão nem impedir importar e-mails.

O total de provedores soma somente contas com cota individual disponível, deduplicando conexões da mesma conta/raiz. Informa a quantidade de caixas consultadas e identifica total parcial quando há caixas sem cota. Esse total representa as cotas individuais reportadas, não uma medição física exclusiva do provedor. A quota não informada nunca é substituída pelo limite do APMail.

## Publicação

Aplicar `0018_storage_quotas.sql` se pendente e `0019_provider_account_quota.sql`, atualizando API, web e worker juntos. A migration 0019 invalida somente observações antigas do provedor, que poderiam representar a quota do domínio; a próxima sincronização consulta novamente. Preserva mensagens, arquivos, cotas do APMail e checkpoints. Não utilizar o procedimento histórico de reset de produção para publicar esta entrega. Detalhes em [DEPLOY.md](DEPLOY.md).
