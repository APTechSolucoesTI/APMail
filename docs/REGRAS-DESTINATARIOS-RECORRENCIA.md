# Regras, destinatários e recorrência

## Regras e etiquetas

O teste recebe o ID da conversa e resolve a mensagem recebida mais recente visível naquela caixa. Ele avalia as condições sem aplicar ações. As etiquetas pessoais e globais compartilham a consulta completa; cada tela filtra sua própria visualização sem substituir o cache das outras telas.

Regras podem mover, sinalizar, etiquetar e fixar. Ações pessoais de etiqueta/fixação continuam privadas; mover ou sinalizar altera a caixa e exige organização. Regras da caixa podem também atribuir responsável, excluir da fila e encaminhar, respeitando as permissões existentes. A fixação compartilhada aparece para todos os usuários com acesso à conversa e tem ação própria para desafixar.

Nas caixas POP3 e locais, as ações locais não abrem conexão IMAP nem dependem de credenciais do provedor. Em IMAP, uma movimentação recusada pelo provedor não é registrada como concluída no banco. Encaminhamentos automáticos respeitam a autorização da empresa e a situação da regra novamente antes do envio.

Ao aplicar regras existentes, é possível escolher 30, 90 ou 365 dias, ou todo o histórico, inclusive mensagens antigas importadas. O processamento acontece no worker e independe da permanência na tela.

## Autocomplete de destinatários

A partir de dois caracteres, os campos Para, Cc e Cco consultam endereços de mensagens acessíveis, contas e aliases disponíveis, usuários ativos da empresa e os diferentes e-mails dos contatos visíveis. Cada sugestão representa um endereço, com nome e e-mail completos; não é necessário cadastrar um contato para sugerir um endereço já presente no sistema.

A consulta respeita empresa, acesso à caixa e visibilidade das pastas, elimina endereços repetidos e usa debounce de 350 ms. As opções podem ser escolhidas com mouse, setas e Enter/Tab; Escape fecha a lista.

## Envios recorrentes

Em **Agendar envio**, habilitar **Repetir este envio** e escolher intervalo em horas, dias, semanas ou meses. É possível não estabelecer término, definir uma data final ou um número de envios, incluindo o primeiro.

O agendamento é persistido no servidor. Fechar o editor, sair do sistema ou desligar o computador do usuário não interrompe envios já agendados; o servidor e o worker precisam estar funcionando. As séries ativas aparecem em **Agendados**, com próximo horário, progresso e ação para parar os próximos envios.

Regras de execução:

- Há no máximo uma próxima ocorrência preparada, com sequência única para evitar duplicação ao recuperar a fila.
- Intervalos de dias, semanas e meses preservam o horário no fuso escolhido. Meses usam a data inicial como referência: dia 31 passa pelo último dia de um mês curto e volta ao dia 31 quando disponível. Horas representam tempo decorrido.
- Períodos perdidos não geram uma rajada de mensagens atrasadas. Após concluir uma ocorrência, o sistema calcula o próximo horário futuro.
- Corpo, destinatários e anexos são preservados. As próximas ocorrências usam cópias persistentes dos anexos da mensagem enviada, sem depender do upload temporário original.
- Autorização e armazenamento são verificados a cada envio. Falhas aparecem na caixa de saída para retomada; uma mensagem já confirmada como enviada não é reenviada para criar a próxima ocorrência.
- Parar uma série cancela as ocorrências pendentes e impede novas ocorrências. Um envio que já começou pode concluir; mensagens já enviadas são preservadas.

## Banco e publicação

Migration versionada `0030_rules_recurring_schedules.sql`: `threads.is_pinned_global`, tabela `mail_schedule_series`, vínculo/numeração das ocorrências em `outbox`, constraints, índices e integração com a medição de armazenamento. Os tipos do banco incluem essas estruturas.

A migration `0031_recurrence_sequence_not_null.sql` reforça a integridade da sequência obrigatória das ocorrências, sem alterar os dados existentes.

Em produção, API e worker executam o migrador antes de iniciar. O serviço `migrate` do Compose continua funcionando; o lock e os checksums do migrador garantem execução única de cada migration, inclusive em inicialização concorrente. Publicar API, web e worker da mesma versão.

## Validação local — 14/10/2026

- Lint, checagem de tipos e build completo aprovados; nenhuma dependência adicionada.
- 112 testes JavaScript/TypeScript e 11 testes Python aprovados na suíte padrão.
- 53 testes de integração da API aprovados, incluindo contatos, etiquetas, regras, permissões de pastas e operações de conversas.
- 8 testes adicionais de integração com PostgreSQL e Redis reais: prévia sem efeitos, ações POP3/locais, recusa/retomada IMAP, aplicação ao histórico antigo, autorização de encaminhamento, autocomplete, recorrência com anexos binários, recuperação da fila e cancelamento. IMAP/SMTP são transportadores controlados nesses testes; não houve envio a destinatários reais.
- 21 testes de regressão de importação/backup aprovados, incluindo geração e leitura de PST nativo.
- Aplicação aberta e conferida em 1440 × 900, 768 × 1024 e 390 × 844, com temas claro e escuro. Fluxo de teste/aplicação das regras, sugestões por endereço, agendamento persistido após recarregar e cancelamento da série exercitados pela interface. Console sem erros/avisos capturados.
- Migrations aplicadas no PostgreSQL local. API compilada iniciada em modo de produção contra a infraestrutura local isolada, com migrador na inicialização e `/api/health` retornando banco/fila disponíveis.

Deploy Dokploy, migrations do banco de produção e conexões com provedores reais não foram executados neste ambiente. A atualização de produção ocorre no próximo deploy do usuário, usando as migrations automáticas acima.
