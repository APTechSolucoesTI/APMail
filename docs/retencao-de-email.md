# Retenção de e-mails excluídos

A política fica em **Administração → Empresa → E-mail e contatos**. O padrão é 30 dias e o intervalo personalizado vai de 1 a 3.650 dias. O prazo é gravado quando a mensagem sai da Lixeira. Alterar a política não muda o prazo de mensagens já retidas.

Administradores autorizados consultam e restauram em **Administração → E-mails em retenção**. Restaurar devolve a cópia à caixa original do APMail, em Caixa de entrada ou Enviados. Para IMAP, é uma cópia local: a restauração não envia o e-mail de volta ao provedor. A exclusão manual exige a permissão **Excluir definitivamente e-mails em retenção** e a confirmação `EXCLUIR`. A ação em massa informa a contagem de toda a empresa e recusa uma confirmação cuja contagem ficou desatualizada.

O worker verifica os prazos a cada cinco minutos. Ele preserva a identidade técnica usada pela sincronização e pelos relacionamentos, apaga o conteúdo recuperável e remove arquivos sem referências. Anexos usados em rascunhos ou envios impedem a limpeza até serem liberados. Falhas ficam disponíveis para nova tentativa automática. Arquivos em retenção contam no armazenamento até a limpeza.

No IMAP, o APMail oculta a mensagem e registra a retenção antes de solicitar a exclusão remota. Se o servidor não confirmar a operação ou a pasta mudar de identidade, a cópia local permanece em retenção e a falha aparece no painel. A limpeza automática não depende da confirmação do servidor nesses casos.

A migration `0072_mail_retention.sql` preserva os dados existentes e passa a registrar as novas exclusões da Lixeira. Para usar a retenção, atualize a API, o frontend e o worker com as migrations aplicadas.
