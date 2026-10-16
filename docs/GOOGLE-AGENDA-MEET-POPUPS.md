# Google Meet e lembretes de compromissos

Implementação local de 16/10/2026. O [guia Word de configuração](GUIA-INTEGRACAO-GOOGLE.docx) descreve a criação do cliente OAuth, consentimento, variáveis e ativação por usuário. API, worker e web devem ser atualizados juntos, aplicando as migrations `0039`–`0041` pelo fluxo normal. Nenhum banco remoto foi alterado e nenhum deploy foi executado.

## Integrações Google

`Configurações → Integrações → Google` oferece conexão OAuth por usuário e empresa, criação de Google Meet e consentimento opcional para leitura da Google Agenda. O adaptador utiliza os endpoints oficiais via HTTPS, com timeout e sem redirecionamento arbitrário. Não há biblioteca Google adicional nem chaves no frontend.

Variáveis obrigatórias para ativar o Google: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. A URI de retorno é calculada a partir de `APP_URL` com o caminho `/api/integrations/google/callback` e é exibida na interface. A evolução de relatórios também precisa dessas credenciais no worker; o Compose as passa aos dois serviços. Sem configuração, a tela informa a necessidade e não simula uma conexão. Consulte o [complemento de relatórios, consentimento e escopos](GOOGLE-MEET-RELATORIOS.md).

O fluxo usa authorization code com PKCE S256, state aleatório de uso único guardado por dez minutos no Redis e vínculo ao usuário, empresa e sessão autenticada. A confirmação obtém o perfil no endpoint oficial userinfo. Access e refresh tokens ficam cifrados com AES-256-GCM, reutilizando `CREDENTIALS_ENCRYPTION_KEY`. Renovação serializada em transação evita refresh concorrente. Callback e logs não expõem códigos OAuth, tokens ou segredos. Desconectar remove as credenciais locais e tenta revogar no Google, sem apagar eventos nem links existentes.

Escopos básicos: `openid`, `email` e `https://www.googleapis.com/auth/meetings.space.created`. O consentimento da Agenda acrescenta `https://www.googleapis.com/auth/calendar.events.readonly`. A consulta mostra até cem eventos dos próximos noventa dias da agenda principal. Ela não importa eventos, não escreve no Google e não representa sincronização bidirecional.

A criação de Meet chama `POST https://meet.googleapis.com/v2/spaces`. Uma chave persistida em `google_meeting_requests` impede repetir a criação por retry ou clique concorrente. Resultado incerto permanece registrado e não é repetido automaticamente. Só um link efetivamente devolvido pelo Google é apresentado como criado; continua disponível colar um link existente. É necessário salvar o evento para associá-lo. Uma sala gerada e abandonada antes de salvar não é automaticamente apagada no Google.

## Convites e componentes

O editor foi reorganizado em remetente/calendário, título, participantes obrigatórios/opcionais, horários, duração, lembrete, reunião online, descrição rica e opções avançadas. Datas usam o calendário existente; horários pesquisáveis aceitam valores personalizados sem o seletor nativo de datetime. Alterar início conserva a duração. Dia inteiro apresenta o último dia incluído e persiste DTEND exclusivo. A descrição utiliza o TipTap existente com barra compacta e ferramentas adicionais sob demanda.

`meeting_url`, `description_html` sanitizado, disponibilidade e papel dos participantes são transportados pelo calendário e por MIME/ICS. A mensagem HTML do convite inclui data, fuso, local, participantes, descrição e acesso à reunião. ICS inclui URL/CONFERENCE, X-ALT-DESC, ROLE, TRANSP e indicação de disponibilidade para clientes compatíveis. Atualizar somente o link mantém o UID e o RSVP. Reagendar pode reiniciar a confirmação. Atualizações idênticas não criam novas saídas; mudanças salvas sem envio podem ser enviadas depois, uma única vez, mantendo a versão do evento.

## E-mail automático de convites

Em Preferências → E-mail padrão de convite, cada usuário pode salvar seu texto, conta de envio e assinatura por organização. O modelo já vem preenchido e aceita `{{titulo}}` e `{{organizador}}`; data, horário, fuso, local, participantes, pauta opcional e link são adicionados automaticamente. A assinatura pode ser a padrão da conta, uma específica ou nenhuma. Assinaturas específicas de uma conta só são incluídas quando essa conta envia o convite. O HTML da assinatura é preservado na mensagem enfileirada, com o suporte MIME/CID existente para imagens. O texto personalizado é aplicado a REQUEST; respostas e cancelamentos mantêm mensagens adequadas à operação, com a assinatura escolhida.

A migration aditiva `0042_calendar_email_preferences.sql` inclui chave por usuário/organização, FKs, índices e RLS; o acesso ocorre exclusivamente pelas rotas autenticadas do backend, com verificação de permissão de envio e propriedade da assinatura. Não há alteração em mensagens já enfileiradas ou enviadas. Novas reuniões usam a conta preferida; com uma única conta disponível, ela já aparece selecionada na interface. A pauta não é uma etapa de redação obrigatória.

## Pop-ups persistentes

A antecedência fica visível em cada convite: sem lembrete, no horário, 5/10/15/30 minutos, 1 hora, 1 dia ou minutos personalizados. O worker existente materializa o lembrete no banco e o processa independentemente da navegação. O horário de cada ocorrência é preservado separadamente da data de adiamento.

`ReminderCenter` vive no shell autenticado, portanto funciona nas várias seções. O painel lista avisos simultâneos, mostra atraso/antecedência, descrição e participantes e permite abrir o evento, entrar no Meet, adiar, dispensar ou dispensar todos. Não se sobrepõe a outros diálogos; pode ser minimizado. O estado da tarefa permanece no banco após recarregar. Um lembrete minimizado ainda pendente pode ser apresentado novamente após reabrir o aplicativo.

A API concede a apresentação a um único identificador de aba por usuário/empresa. A concessão dura 45 segundos, renovada em intervalos de 15; o cliente deixa de apresentar avisos após perder a renovação. Locks e expiração permitem recuperar a posse quando uma aba fecha ou fica indisponível. O fechamento tenta liberar a concessão via beacon. APIs de ação mantêm validação de usuário e isolamento. Notificações nativas existentes continuam complementares e dependem de permissão; o navegador fechado não pode apresentar um modal do APMail.

## Banco e validação

`0039`: metadados do evento e concessões de lembretes, com índice para avisos notificados. `0040`: conexões Google e solicitações idempotentes, FKs/índices por proprietário e RLS sem acesso SQL direto para papéis sem política, conforme o backend Fastify proprietário existente. `0041`: horários persistidos da ocorrência. Tipos Kysely regenerados. Alterações são incrementais e preservam os dados existentes.

Testes cobrem PKCE/state/sessão, isolamento, tokens cifrados, refresh, consentimento opcional, desconexão, criação idempotente, preservação de RSVP, atualização pendente, ICS/SMTP com link, convidados opcionais, antecedência e posse entre abas. As respostas Google são controladas apenas nos testes; a integração de produção usa os endpoints oficiais. Sem um cliente OAuth real configurado, autorização e criação numa conta Google real não foram executadas.

Navegador Edge/Playwright: configurações sem credenciais, editor com convidados, horário personalizado e duração, link manual, persistência da antecedência, reabertura por link, pop-up em outra seção e adiamento após recarregar. Desktop 1440×900, tablet 768×1024 e celular 390×844, temas claro/escuro, com revisão e correção após as primeiras capturas. O guia Word foi renderizado pelo Word instalado e suas quatro páginas foram inspecionadas.

Referências: [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server), [criação de Meet](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create) e [escopos Calendar](https://developers.google.com/workspace/calendar/api/auth).
