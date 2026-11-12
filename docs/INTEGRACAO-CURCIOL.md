# Integração APMail e Curciol

Documento técnico para consumo da API REST, recebimento de webhooks e abertura do aplicativo instalado. O contrato contempla notificações por caixa e sincronização das conversas de e-mail no histórico do cliente.

Base da API e do aplicativo

```text
https://app.apmail.com.br
```

Os exemplos usam endereços e identificadores ilustrativos. Os recursos de histórico descritos neste documento ficam disponíveis após a publicação da versão correspondente do APMail.

## Autenticação e configuração

As consultas são feitas pelo backend da Curciol, com HTTPS e o cabeçalho abaixo.

```http
Authorization: Bearer TOKEN_DA_INTEGRACAO
```

Em **Configurações → Integrações → Tokens de API**, crie a chave, copie o segredo e autorize as rotas, os usuários e as caixas necessários.

| Permissão              | Acesso                                            |
| ---------------------- | ------------------------------------------------- |
| `notifications:read`   | Contadores por usuário e por caixa                |
| `messages:read`        | Listagem, detalhe de mensagem e conversa completa |
| `attachments:download` | Download autenticado de arquivos                  |

O histórico da Curciol usa `messages:read`. A consulta do envelope usa `notifications:read`. Arquivos podem ser ignorados no histórico.

Guarde a chave em configuração secreta do backend. A validade pode ser ilimitada, caso escolhida no painel. A chave ilimitada permanece válida até revogação ou alteração de suas autorizações. O tenant é identificado pela chave.

O parâmetro `email` identifica um **usuário cadastrado no APMail** e autorizado no token. Para o envelope, use o e-mail do usuário que está consultando suas notificações. Para sincronizar o histórico do escritório, use um usuário de integração autorizado a consultar as conversas das caixas selecionadas. O acesso depende das permissões atuais desse usuário, incluindo restrições de pastas, operadores e convites.

## Rotas disponíveis

| Método | Rota                                                                        | Finalidade                                        |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------- |
| GET    | `/api/integrations/notifications?email=...`                                 | Notificações consolidadas e por caixa             |
| GET    | `/api/integrations/messages?email=...&direction=all`                        | Sincronização incremental de recebidos e enviados |
| GET    | `/api/integrations/messages?email=...&messageId=...`                        | Conteúdo de uma mensagem                          |
| GET    | `/api/integrations/threads/:threadId?email=...`                             | Mensagens da conversa com corpo                   |
| GET    | `/api/integrations/messages/:messageId/attachments/:attachmentId?email=...` | Arquivo em stream                                 |

## Notificações por caixa

```bash
curl --get 'https://app.apmail.com.br/api/integrations/notifications' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=pessoa@empresa.com.br'
```

```json
{
  "success": true,
  "data": {
    "email": "pessoa@empresa.com.br",
    "unread": 5,
    "pending": 3,
    "totals": { "unread": 5, "pending": 3 },
    "hasNotifications": true,
    "mailboxes": [
      {
        "id": "aa034af6-fc6b-4e16-8f6e-a9630cfbdf5c",
        "email": "financeiro@empresa.com.br",
        "name": "Financeiro",
        "unread": 5,
        "pending": 3,
        "url": "/mail/aa034af6-fc6b-4e16-8f6e-a9630cfbdf5c?assigned=any"
      }
    ]
  }
}
```

`unread` conta mensagens não lidas e `pending` conta conversas pendentes. As quantidades são independentes. `totals` corresponde à soma das caixas retornadas, incluindo caixas com zero notificações. `hasNotifications` indica se algum dos totais é maior que zero.

`mailboxes[].url` é o caminho relativo fornecido pelo APMail. Em acesso concedido apenas por convite, o caminho pode ser `/invitations`. Consultar contadores e mensagens preserva o estado de leitura. Uma atualização a cada 30 ou 60 segundos atende ao indicador visual.

## Sincronização de recebidos e enviados

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=integracao@empresa.com.br' \
  --data-urlencode 'direction=all' \
  --data-urlencode 'limit=100'
```

| Parâmetro   | Comportamento                                    |
| ----------- | ------------------------------------------------ |
| `email`     | Obrigatório. Usuário autorizado no token         |
| `direction` | `inbound`, `outbound` ou `all`. Padrão `inbound` |
| `mailboxId` | Opcional. UUID de uma caixa                      |
| `limit`     | De 1 a 100. Padrão 25                            |
| `cursor`    | Valor opaco devolvido pela consulta anterior     |

O retorno usa a estrutura abaixo. Os itens foram abreviados neste exemplo. Cada item real contém os campos do contrato de mensagem apresentado adiante, com `body: null` e `bodyIncluded: false`.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "60862da5-9a2f-411a-89a3-d54147793789",
        "threadId": "0aa125a2-6100-4fd2-b37a-09f0711280a2",
        "direction": "inbound",
        "body": null,
        "bodyIncluded": false
      }
    ],
    "nextCursor": "VALOR_OPACO_RETORNADO_PELO_APMAIL",
    "hasMore": false
  }
}
```

Na primeira sincronização, consulte sem cursor. Processe os itens, persista-os por `id` e guarde `nextCursor` somente depois da conclusão do processamento. Enquanto `hasMore` for `true`, consuma a próxima página. Quando for `false`, guarde o cursor e reutilize-o na consulta periódica seguinte.

O cursor usa uma sequência persistente por empresa, compartilhada por recebidos e enviados. Ele acompanha os commits das mensagens e continua funcionando após reinício dos serviços. A ordem da sequência representa a entrada na integração. Para apresentação cronológica, use `messageAt`.

Mantenha um cursor por token, usuário, filtro de caixa e `direction`. Ao alterar um desses parâmetros, inicie outra sincronização sem cursor. Cursores anteriores à opção `direction` continuam válidos para recebidos. Para adotar `all`, comece sem cursor e faça atualização por `id` para evitar duplicar mensagens já importadas.

Os envios anteriores à atualização do APMail também ficam disponíveis nessa sincronização. Leituras, mudanças de responsável e exclusões não são eventos dessa listagem. Ao precisar do estado atual de uma conversa, consulte sua rota de detalhe.

## Conteúdo da mensagem

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=integracao@empresa.com.br' \
  --data-urlencode 'messageId=60862da5-9a2f-411a-89a3-d54147793789'
```

O UUID usado na query `messageId` é o campo `data.id`. O campo `data.messageId` contém o cabeçalho original do e-mail.

```json
{
  "success": true,
  "data": {
    "id": "60862da5-9a2f-411a-89a3-d54147793789",
    "messageId": "<original@cliente.com.br>",
    "threadId": "0aa125a2-6100-4fd2-b37a-09f0711280a2",
    "tenantId": "923cf5f0-dda0-4813-aad8-5761b381903d",
    "mailbox": {
      "id": "aa034af6-fc6b-4e16-8f6e-a9630cfbdf5c",
      "email": "financeiro@empresa.com.br",
      "name": "Financeiro"
    },
    "direction": "outbound",
    "subject": "Re: Documentação",
    "from": { "name": "Financeiro", "email": "financeiro@empresa.com.br" },
    "to": [{ "name": "Cliente", "email": "cliente@cliente.com.br" }],
    "cc": [],
    "bcc": [],
    "replyTo": [],
    "messageAt": "2026-11-12T13:00:00.000Z",
    "receivedAt": "2026-11-12T13:00:01.000Z",
    "isRead": true,
    "body": {
      "text": "Documentação recebida. Obrigado.",
      "html": "<p>Documentação recebida. Obrigado.</p>",
      "sanitizedHtml": "<p>Documentação recebida. Obrigado.</p>",
      "hasHtml": true,
      "originalAvailable": false
    },
    "bodyIncluded": true,
    "inReplyTo": "<anterior@cliente.com.br>",
    "references": ["<anterior@cliente.com.br>"],
    "status": "awaiting_reply",
    "assignedTo": "b807ff2e-b98a-4a0a-a210-cfc0d13cde2b",
    "assignedToUser": {
      "id": "b807ff2e-b98a-4a0a-a210-cfc0d13cde2b",
      "name": "Atendente",
      "email": "atendente@empresa.com.br"
    },
    "sentByUser": {
      "id": "b807ff2e-b98a-4a0a-a210-cfc0d13cde2b",
      "name": "Atendente",
      "email": "atendente@empresa.com.br"
    },
    "isHistorical": false,
    "isAutomated": false,
    "isReadReceipt": false,
    "isFlagged": false,
    "source": "imap",
    "size": 1240,
    "attachments": [],
    "attachmentCount": 0,
    "hasAttachments": false
  }
}
```

`assignedToUser` identifica o responsável atual pela conversa. `sentByUser` identifica quem efetivamente enviou a mensagem pelo APMail. Os campos podem ser `null`, inclusive em enviados importados sem autoria conhecida. Use o e-mail dessas estruturas para relacionar o atendente ao usuário da Curciol. `assignedTo` continua disponível como UUID.

`messageAt` contém a data da mensagem e `receivedAt` registra a persistência local. Datas são ISO 8601 em UTC. `status` usa os estados operacionais do APMail, incluindo `none`, `to_reply`, `in_progress`, `awaiting_reply`, `scheduled` e `done`.

`body.html` usa o original preservado quando disponível e o HTML armazenado nos demais casos. `originalAvailable` indica a disponibilidade do original. Assinaturas, citações e formatação acompanham o corpo. A Curciol deve sanitizar o HTML novamente antes de exibi-lo, bloqueando scripts e conteúdo ativo.

## Conversa completa

```bash
curl --get 'https://app.apmail.com.br/api/integrations/threads/0aa125a2-6100-4fd2-b37a-09f0711280a2' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=integracao@empresa.com.br' \
  --data-urlencode 'limit=50'
```

O retorno é `{ "success": true, "data": { "threadId": "UUID", "items": [], "nextCursor": null, "hasMore": false } }`. `items` traz recebidos e enviados visíveis, com o contrato completo acima e `bodyIncluded: true`, ordenados por `messageAt` e UUID.

A paginação aceita `limit` entre 1 e 50, com padrão 25. Quando `hasMore` for `true`, envie `nextCursor` no parâmetro `cursor` da mesma rota. Ao final, `nextCursor` é `null`. O cursor da conversa e o cursor da sincronização de mensagens têm finalidades diferentes e são usados em suas respectivas rotas.

No histórico da Curciol, apresente uma linha por `threadId`. Relacione a conversa ao cliente pelos endereços em `from`, `to` e `cc`. Ao abrir a linha, carregue a conversa e exiba assunto, remetente, destinatários, data e corpo sanitizado de cada mensagem.

## Webhooks

Em **Configurações → Integrações → Webhooks**, configure a URL do backend receptor, as caixas monitoradas e os eventos desejados.

| Evento           | Momento                                               |
| ---------------- | ----------------------------------------------------- |
| `email.received` | Persistência de novo e-mail recebido via IMAP ou POP3 |
| `email.sent`     | Persistência da mensagem após envio pelo APMail       |

O APMail envia um `POST` ao endereço cadastrado pela integração. Esse endereço é criado no backend da Curciol e precisa ser HTTPS público na porta 443. O recebimento usa um segredo HMAC próprio. Para consultas complementares, use o token da API.

```http
Content-Type: application/json
X-APMail-Timestamp: 1794488400
X-APMail-Event-Id: 99f94542-aa5b-479d-8374-06cb3e1b8764
X-APMail-Signature: sha256=HEXADECIMAL_HMAC
```

```json
{
  "event": "email.sent",
  "eventId": "99f94542-aa5b-479d-8374-06cb3e1b8764",
  "timestamp": "2026-11-12T13:00:01.000Z",
  "test": false,
  "data": {
    "id": "60862da5-9a2f-411a-89a3-d54147793789",
    "threadId": "0aa125a2-6100-4fd2-b37a-09f0711280a2",
    "direction": "outbound"
  }
}
```

O objeto `data` foi abreviado no exemplo. A entrega real usa o mesmo contrato da mensagem completa. No webhook, `data.isRead` é `null`, pois o evento representa a caixa. Para consultar leitura individual, use um GET com o e-mail do usuário.

O limite do payload é 2 MiB. Se o corpo ultrapassar o limite, `data.body` será `null` e `data.bodyIncluded` será `false`. O consumidor recupera o conteúdo pela API. Os arquivos são entregues por download autenticado. O teste pelo painel envia `test: true` e `data: null`, com assinatura válida.

### Assinatura

Use diretamente a string do segredo como chave UTF-8 e calcule HMAC-SHA256 de `timestamp + "." + corpo HTTP bruto`. A validação deve ocorrer antes do processamento do JSON. Exemplo em Node.js para o backend receptor.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function validarWebhookAPMail(rawBody, headers, secret) {
  const timestamp = headers['x-apmail-timestamp'];
  const signature = headers['x-apmail-signature'];
  if (typeof timestamp !== 'string' || !/^\d{10,12}$/.test(timestamp)) return false;
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
```

Capture o corpo bruto como bytes antes do parser JSON do framework. Depois de validar, confira `event`, `test` e a correspondência entre o `eventId` do corpo e o cabeçalho. Deduplicate eventos por `eventId` em armazenamento persistente.

O receptor deve responder `2xx` rapidamente após aceitar e persistir o evento. O processamento da conversa pode ocorrer em background. O APMail faz até cinco tentativas, com intervalos de 1 minuto, 5 minutos, 15 minutos e 1 hora. O timeout HTTP é de 10 segundos. O mesmo evento pode ser reenviado se uma resposta se perder.

As entregas pendentes ficam persistidas no banco e são verificadas pelo worker a cada 15 segundos. O painel apresenta resultados e reenvios. As mensagens antigas entram pela sincronização por cursor. Os webhooks acompanham os novos eventos das caixas configuradas.

## Download de anexos

Cada item de `attachments` inclui `id`, `filename`, `contentType`, `size`, `inline`, `contentId`, `downloadUrl` e `security`. O campo `downloadUrl` é relativo à instalação. Acrescente `email` e o Bearer para baixar os bytes.

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages/60862da5-9a2f-411a-89a3-d54147793789/attachments/8c31069b-e5c5-4900-bc97-b0fc77baab22' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=integracao@empresa.com.br' \
  --output documento.pdf
```

O download exige `attachments:download` e passa pelas verificações de acesso e antivírus. A resposta é binária em stream. No histórico de atendimento, a Curciol pode exibir somente o corpo e oferecer a abertura da mensagem no APMail.

## Abertura no aplicativo instalado

Para a caixa do envelope, use o caminho recebido em `mailboxes[].url`.

```js
const linkCaixa = 'web+apmail://abrir?caminho=' + encodeURIComponent(mailbox.url);
const linkMensagem = 'web+apmail://mensagem/' + message.id;
```

Abra o link por clique do usuário. O APMail registra o protocolo na instalação pelo navegador e usa `navigate-existing` para direcionar a janela já aberta. A rota de entrada `/abrir-externo` valida o destino e trata a continuação após o login. O caminho da caixa deve ser usado como recebido, com seus filtros.

A confirmação inicial e a abertura dependem do suporte e das permissões do navegador. A Curciol pode usar uma observação aproximada de foco para apresentar o aviso de instalação. O cadastro de cliente pode oferecer **Abrir no APMail** usando o UUID interno da mensagem.

## Erros e limites

Erros seguem o formato `{ "error": { "code": "codigo", "message": "Descrição" } }`.

| HTTP | Tratamento                                                                          |
| ---- | ----------------------------------------------------------------------------------- |
| 400  | Verifique parâmetros e contexto do cursor. Cursor inválido retorna `invalid_cursor` |
| 401  | Verifique token, validade, revogação e disponibilidade da empresa                   |
| 403  | Verifique a permissão da rota. Arquivos podem estar bloqueados por segurança        |
| 404  | Usuário, mensagem ou conversa indisponível no escopo autorizado                     |
| 409  | Arquivo aguardando análise ou com falha de verificação                              |
| 429  | Aguarde o prazo indicado e aplique backoff                                          |
| 5xx  | Trate como falha temporária e preserve o último cursor processado                   |

Notificações aceitam até 1.200 consultas por minuto por token. As consultas de conteúdo, conversas e arquivos compartilham o limite de 300 por minuto por token.

Para produção, combine webhooks com uma consulta de recuperação por cursor a cada poucos minutos. Na homologação da Curciol na porta 90, use a sincronização por GET. A interface principal da Curciol pode continuar operando durante uma indisponibilidade do APMail e atualizar os dados quando a comunicação for restabelecida.
