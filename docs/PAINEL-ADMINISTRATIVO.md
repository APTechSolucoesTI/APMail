# Painel Administrativo

O menu da foto oferece Painel Administrativo e Meu perfil. A administração fica em `/admin`, na mesma sessão e empresa do e-mail. Cada seção segue a permissão concedida; o painel não concede acesso a outras caixas. O Dashboard das caixas permanece em `/dashboard`.

As rotas antigas de caixas, empresa, equipe, perfis, auditoria, antivírus, integrações e relatórios redirecionam para o painel, preservando o endereço de detalhe e a busca. O callback OAuth externo do Google continua igual; somente o retorno interno mudou. A conexão Google continua individual.

## Domínios

O administrador cadastra domínios e consulta MX, NS, SPF, DMARC e DKIM, este último com seletor informado pelo provedor. Não é necessário comprovar propriedade. Os registros são consultivos: não comprovam entrega e não alteram DNS. Falha de consulta, ausência e falta de seletor são estados distintos. DMARC pode indicar a política herdada do domínio organizacional.

Conectar uma caixa mantém o fluxo IMAP/POP3/arquivo local existente. O endereço pode ser preenchido por parte inicial e domínio. A conta precisa existir no provedor. Nenhuma conta é criada na hospedagem. O servidor valida o endereço completo e deriva o vínculo do domínio na mesma transação.

Domínios em uso não podem ser removidos. O diagnóstico é limitado em frequência, duração e tamanho; clicar novamente em menos de um minuto reutiliza a observação. `domains.view` e `domains.manage` permitem delegar essas funções; a conexão de caixas pode cadastrar o nome de um domínio sem conceder edição avançada.

## Filas e preferências

Empresa → E-mail e contatos controla a exibição de filas, responsáveis e SLA para toda a equipe. A classificação interna continua ativa quando a interface está oculta. Resumo pode continuar reunindo as caixas de entrada; tarefas, lembretes, envios e calendário não dependem da exibição das filas.

Ao reativar, o worker atualiza as conversas por empresa em lotes e mantém as conclusões válidas, exclusões e responsáveis. O progresso é persistido e gerações antigas não substituem novas. A configuração individual antiga de filas deixa de controlar a interface. Novas empresas começam com filas visíveis.

Preferências → E-mail permite agrupar as caixas acessíveis por domínio. Essa escolha pertence à pessoa; o recolhimento dos grupos é uma preferência local por pessoa e empresa. O Resumo permanece acima dos grupos.

## Horário de acesso por usuário

Em Equipe e acesso → Usuários, a coluna Horário de acesso abre a configuração individual. A opção **Pode acessar a qualquer horário** inicia ativada para todos os usuários existentes. Enquanto ativa, dispensa o preenchimento e desabilita a grade e as exceções. Desativá-la permite configurar segunda a domingo, até quatro intervalos por dia e exceções por data. Um dia sem intervalos bloqueia o acesso. Cada exceção substitui o dia inteiro: sem intervalos para um feriado; com intervalos para um expediente extraordinário.

O fuso é sempre o da empresa, independentemente do computador ou da preferência pessoal. O início é inclusivo e o fim é exclusivo: 08:00–17:00 permite entrada às 08:00 e bloqueia às 17:00. Pausas podem ser representadas por intervalos separados. Para turnos que atravessam a meia-noite, configure os dois dias; `24:00` é aceito como fim do dia.

A API verifica o horário em cada requisição autenticada, na criação de sessões (inclusive na conclusão do segundo fator) e na troca de empresa. Conexões ociosas são verificadas no limite de cada minuto e desconectadas quando o expediente termina; a sessão é revogada, exigindo novo login. Uma alteração administrativa desconecta as conexões da pessoa para reavaliar a regra imediatamente. Horários são isolados por vínculo com a empresa; não alteram filas, recebimento, envios agendados ou expediente de outras pessoas. Contas globais da plataforma continuam sem acesso operacional às caixas.

Somente quem possui `users.manage` pode configurar. Gestores com acesso delegado não podem alterar a própria regra nem a de administradores; apenas proprietários alteram a regra de outro proprietário. Alterações são registradas na auditoria. Administradores operacionais também cumprem a regra quando configurados.

Requer a migration aditiva `0067_member_access_schedule.sql`, que adiciona metadados à associação do usuário e preserva sessões e dados existentes. API e web devem usar a mesma revisão. Nenhum horário restritivo é ativado automaticamente.

## Conversas

Assunto, remetente ou destinatário iguais não criam um vínculo de resposta. O recebimento usa a identidade da mensagem, o pai direto e as referências de ancestrais. Identidades pendentes permitem receber uma resposta antes da mensagem original. E-mails novos e encaminhamentos iniciam conversas independentes; responder e responder a todos mantêm a conversa. Concluir muda somente o atendimento.

Conversas antigas não são divididas nem unidas em massa. Uma resposta explícita pode continuar ligada a uma conversa antiga. Cabeçalhos ausentes ou contraditórios não são reconstruídos por semelhança de assunto.

## Atualização

Aplicar migrations `0063_thread_identities.sql`, `0064_tenant_mail_policy.sql`, `0065_tenant_domains.sql` e `0066_thread_identity_cleanup.sql` antes de executar os novos serviços. Elas preservam mensagens e credenciais. A migration de domínios vincula endereços ASCII existentes; o worker completa vínculos IDNA ausentes, sem alterar os endereços. A migration 0066 mantém a limpeza definitiva de caixas compatível com os novos metadados de conversa.

Atualizar API, worker e web juntos pelo Dokploy. Conferir `/admin`, o retorno de uma rota antiga, a conexão de caixas e a política da empresa. O migrator mantém checksums e não reaplica migrations já registradas. Não executar reset de produção.
