# Recuperação automática das caixas de e-mail

Uma queda de rede anteriormente colocava a caixa em `error` e removia o agendamento,
sem retomar o recebimento até o administrador clicar em Reconectar.

Agora o worker persiste a próxima tentativa e publica reconexões na fila:

- Falhas temporárias: 15 s, 30 s, 1 min, 2 min e depois a cada 5 min, sem limite total.
- Autenticação: alerta imediato e nova tentativa a cada 30 min, evitando insistência
  rápida que poderia bloquear a conta no provedor. Senhas inválidas precisam ser corrigidas.
- TLS/certificado: alerta imediato e espera de 15 min. Não há desativação automática
  da validação de certificados nem downgrade de segurança.

Os intervalos são esperas mínimas; fila ocupada ou lock de uma sincronização em curso
podem adiar a execução. O watchdog recompõe trabalhos/agendamentos a partir do banco
após reinício do worker ou perda de dados do Redis. Publicação perdida na fila não
apaga o plano persistido. As tarefas têm identificação estável para evitar duplicações.

Quando o provedor volta, a caixa torna-se ativa, o agendamento é restaurado e uma
sincronização é solicitada imediatamente. UIDs/UIDL e checkpoints existentes são
preservados. Falhas de SMTP não bloqueiam o teste de recuperação do recebimento:
SMTP continua sendo validado no cadastro/alteração e no fluxo de envio existente.

Uma falha temporária exibe **Reconectando**, com aviso de recuperação automática.
**Tentar agora** é opcional para administradores. Falhas de senha/TLS continuam
destacadas para correção. A interface atualiza o estado por eventos e consulta
periódica enquanto a caixa está em recuperação. Não informa que a caixa está online
durante uma falha real.

Notificações de indisponibilidade temporária só começam na terceira falha, com uma
notificação por administrador e interrupção. A auditoria registra a falha inicial,
o alerta persistente e o restabelecimento; logs não incluem credenciais nem MIME.
Caixas desabilitadas, excluídas ou de empresas suspensas não são reconectadas.
Uma revisão de configuração impede que respostas atrasadas de conexões antigas
sobrescrevam uma nova senha/configuração ou reativem uma caixa desabilitada.

## Publicação

Atualizar API, worker e web juntos pelo Dokploy. A migration aditiva
**0057_mailbox_connection_recovery.sql** acrescenta contadores, classificação,
datas, revisão e índice de recuperação em `mailboxes`. Não muda credenciais,
mensagens, pastas nem protocolos e não exige nova variável de ambiente.
Caixas já em erro passam a ser consideradas automaticamente pelo watchdog.

O recebimento continua sendo processado no servidor, independentemente de o usuário
estar conectado ao navegador. Não há como impedir quedas de internet/provedor;
a melhoria garante a retomada automática enquanto a caixa estiver habilitada e as
credenciais/configuração forem válidas. A sincronização normal mantém o intervalo
`WORKER_SYNC_EVERY_SECONDS`, padrão de 60 segundos.

## Validação

- Integrações com PostgreSQL e Redis exclusivos de QA: queda/retorno, recebimento de
  nova mensagem com cursor preservado e sem duplicação, tentativas contínuas,
  notificações deduplicadas, publicação perdida na fila, configuração antiga,
  desativação concorrente, exclusão e suspensão.
- Reconexão consumida pelo worker BullMQ após os 15 segundos reais, sem intervenção.
- Clientes reais IMAP e POP3 conectados a servidores TCP locais controlados de teste.
  A sessão IMAP é encerrada pelo servidor e a conexão seguinte se recupera.
- Testes da interface para recuperação, senha inválida, restrição da ação manual
  e retorno ao estado ativo; revisão visual com componentes reais em três tamanhos
  de tela e nos temas claro/escuro.
- A suíte externa completa de Greenmail IMAP/SMTP e os casos de conversão PST
  permanecem dependentes dos respectivos serviços de QA. Não foram usados e-mails
  de clientes nem enviados e-mails externos nestes testes.

A produção foi consultada apenas para diagnóstico; deploy e migration de produção
ficam com o responsável pelo Dokploy.

Resultados de 26/10/2026: lint, typecheck e build aprovados; unitários shared 104,
banco 80, API 11, worker 58 e web 156 aprovados, além dos 11 casos Python.
Integrações: 184 cenários API, 72 worker (incluindo 12 de recuperação) e 11 de banco
aprovados. Dois cenários PST ficaram ignorados por ausência do conversor; o teste
opcional do ClamAV real não foi habilitado nesta rodada de conexão.
