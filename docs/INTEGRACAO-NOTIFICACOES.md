# API de notificações para integrações

Para consultar conteúdo e anexos ou receber eventos de chegada, consulte [API de mensagens e Webhooks](INTEGRACAO-MENSAGENS-WEBHOOKS.md). Esses recursos possuem permissões/configurações próprias e não alteram o contrato de notificações abaixo.

Depois do deploy, a consulta é `GET https://app.apmail.com.br/api/integrations/notifications?email=usuario%40empresa.com.br`.

No painel administrativo, abra Integrações e a aba Tokens de API. Crie uma chave com um nome e validade de 30, 90 ou 365 dias, ou ilimitada. O segredo aparece uma única vez. Depois, clique em Configurar acessos ou Acessos, autorize a rota GET /api/integrations/notifications e selecione os usuários que ela poderá consultar. Chaves novas começam sem rotas autorizadas. Guarde o segredo em uma variável de ambiente no backend do sistema integrado. Renovar invalida o segredo anterior imediatamente e preserva os acessos configurados. Chaves ilimitadas continuam sem vencimento. As demais recebem validade de 90 dias. Revogar encerra o acesso. Depois de revogar, o botão Excluir remove definitivamente a chave e seus vínculos após confirmação. A ação fica registrada na auditoria.

O catálogo de rotas para integrações fica em `apps/api/src/modules/integration-api-routes.ts`. Cada rota publicada tem método, endereço, descrição e permissão próprios. O helper `integrationApiAccess` valida o token e a permissão exigida no backend. Adicionar uma rota ao catálogo não concede acesso automático às chaves existentes. A migration 0076 preserva os acessos de notificações das chaves criadas anteriormente.

```sh
curl --get 'https://app.apmail.com.br/api/integrations/notifications' \
  --header "Authorization: Bearer $APMAIL_INTEGRATION_TOKEN" \
  --data-urlencode 'email=usuario@empresa.com.br'
```

```json
{
  "success": true,
  "data": {
    "email": "usuario@empresa.com.br",
    "unread": 3,
    "pending": 2,
    "totals": {
      "unread": 3,
      "pending": 2
    },
    "hasNotifications": true,
    "mailboxes": [
      {
        "id": "4fb136f9-ef86-4520-9cd9-d30397008478",
        "email": "financeiro@empresa.com.br",
        "name": "Financeiro",
        "unread": 3,
        "pending": 2,
        "url": "/mail/4fb136f9-ef86-4520-9cd9-d30397008478?assigned=any"
      },
      {
        "id": "78477d64-83fe-4252-8946-b96613265e4f",
        "email": "comercial@empresa.com.br",
        "name": "Comercial",
        "unread": 0,
        "pending": 0,
        "url": "/mail/78477d64-83fe-4252-8946-b96613265e4f?assigned=any"
      }
    ]
  }
}
```

`unread` conta mensagens recebidas depois do último registro de leitura daquela conversa pelo próprio usuário. A leitura de outra pessoa não altera esse contador. Abrir uma conversa no APMail marca suas mensagens como lidas conforme o fluxo atual. A consulta da integração não altera a leitura, as mensagens ou os atendimentos.

`pending` conta conversas visíveis em A Responder ou Em Atendimento. Inclui caixas com filas desativadas na interface, pois o cálculo continua ativo internamente. Conversas excluídas das filas não entram nesse total. Os campos são independentes e podem representar a mesma conversa. Não devem ser somados.

Os campos existentes `data.unread` e `data.pending` continuam sendo os totais consolidados. `data.totals` repete esses valores e corresponde à soma de `data.mailboxes`. Cada caixa aparece uma única vez, incluindo caixas sem notificações. As contagens são agregadas em uma consulta, sem uma consulta por caixa. As mensagens são contadas por seu identificador persistido, mesmo quando a autorização vem simultaneamente de vínculo e convite.

Os IDs são UUIDs reais do APMail. Os valores no exemplo são ilustrativos. `mailboxes[].url` é um endereço relativo ao próprio APMail. Para membros da caixa, aponta para `/mail/{id}?assigned=any`. Esse filtro exibe as conversas autorizadas independentemente do responsável, mantendo as restrições de operadores. Para acesso exclusivo por convite, aponta para `/invitations`, onde somente as conversas convidadas podem ser abertas. A caixa deixa de ser retornada quando o convite termina e não existe vínculo com ela. Nenhum conteúdo, assunto, anexo ou conversa de terceiros é retornado.

As contagens respeitam o usuário autorizado pelo token, seu perfil, os vínculos explícitos com caixas, as pastas e subpastas permitidas, a restrição de operadores e os convites ativos. Lixeira, spam, mensagens retidas e registros excluídos ficam fora. Confirmações de leitura seguem o critério existente de mensagens não lidas. O e-mail do usuário é normalizado para minúsculas. O tenant vem exclusivamente do token, independentemente da empresa selecionada em sessões interativas.

As respostas usam `Cache-Control: no-store`. O token permite apenas esta consulta, sem ler conteúdo ou operar outras APIs. O banco guarda SHA-256 do segredo aleatório. Criação, renovação e revogação são auditadas. O limite é de 1.200 consultas por minuto por token, compartilhado pelo Redis entre instâncias. Credenciais inválidas têm um limite separado de 60 tentativas por minuto por IP. Não há cache de contagens no servidor.

Os erros seguem `{"error":{"code":"...","message":"..."}}`. Um e-mail inexistente, fora da lista, desativado ou sem acesso ao módulo recebe a mesma resposta 404. A API não distingue esses casos.

| HTTP                 | Tratamento no sistema integrado                                                       |
| -------------------- | ------------------------------------------------------------------------------------- |
| 400                  | Conferir o formato do e-mail enviado.                                                 |
| 401                  | Token ausente, inválido, expirado ou revogado. Corrigir a configuração da integração. |
| 403                  | Usar HTTPS em produção e conferir se a rota está autorizada para a chave.             |
| 404                  | O usuário não está disponível no escopo autorizado. Ocultar a contagem.               |
| 429                  | Respeitar o cabeçalho Retry-After.                                                    |
| 5xx ou falha de rede | Exibir indisponibilidade discreta e tentar novamente no próximo ciclo.                |

A API exige HTTPS em produção. O proxy reverso do ambiente deve ser o único acesso externo ao backend e informar o protocolo original. O log de acesso web omite os parâmetros da URL, e o logger da API oculta Authorization e cookies.

## Implementação no Curciol

Crie uma rota autenticada no backend do Curciol que consulte a API com o e-mail da sessão atual. O navegador chama somente essa rota local. Use `APMAIL_API_BASE_URL=https://app.apmail.com.br` e `APMAIL_INTEGRATION_TOKEN` como configuração privada do servidor. Não receba um e-mail arbitrário do navegador para consultar outra pessoa.

Atualize ao entrar e a cada 60 segundos, com timeout de 5 segundos e uma requisição por vez. Pause consultas quando a página estiver oculta e retome ao voltar. Exiba um sininho com badge de `totals.unread`. Ao clicar, abra uma lista de `mailboxes`, com nome, endereço e contagem de não lidos, incluindo as caixas zeradas. A quantidade pendente pode aparecer como informação secundária. Abra a caixa usando `new URL(mailbox.url, APMAIL_API_BASE_URL)`, conferindo que a origem é a do APMail, em outra aba com `noopener noreferrer`. O destino usa a autenticação e autorização normais do APMail.

Durante indisponibilidade, mantenha a última contagem com indicação discreta de desatualização por até cinco minutos. Depois, apresente o indicador sem número. Uma falha não deve ser apresentada como zero nem impedir o uso do Curciol. Nunca registre o token ou o e-mail consultado em logs rotineiros.
