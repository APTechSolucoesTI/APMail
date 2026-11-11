# API de mensagens e webhooks do APMail

Base da instalação atual: `https://app.apmail.com.br`. As rotas abaixo ficam disponíveis após o deploy desta versão. A API existente de notificações permanece em `GET /api/integrations/notifications?email=...`, com o mesmo contrato e contagens.

## Configuração administrativa

Em **Configurações → Integrações**:

- **Tokens de API**: use a tela existente para criar uma chave, copiá-la uma única vez e configurar os acessos. As permissões são independentes: `notifications:read` (contadores), `messages:read` (consulta de mensagens) e `attachments:download` (arquivos). Selecione os usuários autorizados. Para conteúdo e arquivos, selecione também as caixas autorizadas. Somente caixas das quais o administrador é explicitamente **Administrador da caixa** podem ser autorizadas para exportação. A consulta ainda respeita o acesso atual do usuário informado. Tokens antigos não recebem novas permissões automaticamente; validade ilimitada, renovação, revogação e exclusão continuam funcionando como antes.
- **Webhooks**: cadastre nome, URL HTTPS pública, evento `email.received` e caixas monitoradas. Copie o segredo HMAC uma única vez. É possível editar, ativar/desativar, testar, consultar entregas/tentativas, reenviar entregas encerradas, gerar outro segredo e excluir a configuração. Excluir exige confirmação e remove seu histórico, sem excluir mensagens.

Os recursos são independentes. Receber um webhook não exige token de API. Consultar mensagens ou baixar arquivos exige token com a permissão correspondente, mesmo que o consumidor já possua o segredo HMAC.

O webhook exporta os e-mails das caixas explicitamente selecionadas pelo administrador; não representa a visão de um usuário específico. A API GET representa a visão do usuário identificado pelo parâmetro `email`, limitada adicionalmente às concessões do token.

## Autenticação dos GETs

Todas as chamadas são feitas **do backend do sistema consumidor**, por HTTPS:

```http
Authorization: Bearer TOKEN_DA_INTEGRACAO
```

Guarde o token em configuração secreta do servidor. Não o envie ao JavaScript do navegador, à URL, a logs ou ao repositório. O tenant é determinado pelo token, nunca por um parâmetro informado pelo consumidor. `email` identifica um usuário cadastrado no APMail e previamente autorizado na chave, não uma caixa.

Não são necessários cookies, login interativo, refresh token ou renovação periódica para uma chave de validade ilimitada. Revogação, remoção das concessões, suspensão da empresa e alterações nas permissões passam a valer nas próximas consultas. As consultas não marcam e-mails como lidos nem alteram o atendimento.

## Consultar uma mensagem

`GET /api/integrations/messages?email=USUARIO&messageId=UUID`

Exemplo (substitua token, usuário e UUID por valores reais):

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=usuario@empresa.com.br' \
  --data-urlencode 'messageId=60862da5-9a2f-411a-89a3-d54147793789'
```

O `messageId` da query é o **UUID interno**, retornado em `data.id`, e não o cabeçalho RFC Message-ID. Um exemplo ilustrativo, com os nomes de campos do contrato real:

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
    "direction": "inbound",
    "subject": "Documentação solicitada",
    "from": { "name": "Cliente", "email": "cliente@cliente.com.br" },
    "to": [{ "name": "Financeiro", "email": "financeiro@empresa.com.br" }],
    "cc": [],
    "bcc": [],
    "replyTo": [],
    "messageAt": "2026-11-11T18:59:00.000Z",
    "receivedAt": "2026-11-11T19:00:00.000Z",
    "isRead": false,
    "body": {
      "text": "Segue documento. Assinatura do cliente.",
      "html": "<p>Segue documento.</p><img src=\"cid:logo\">",
      "sanitizedHtml": "<p>Segue documento.</p><img src=\"cid:logo\">",
      "hasHtml": true,
      "originalAvailable": true
    },
    "bodyIncluded": true,
    "inReplyTo": "<anterior@empresa.com.br>",
    "references": ["<anterior@empresa.com.br>"],
    "status": "to_reply",
    "assignedTo": null,
    "isHistorical": false,
    "isAutomated": false,
    "isReadReceipt": false,
    "isFlagged": false,
    "source": "imap",
    "size": 245780,
    "attachments": [
      {
        "id": "8c31069b-e5c5-4900-bc97-b0fc77baab22",
        "filename": "logo.png",
        "contentType": "image/png",
        "size": 1240,
        "inline": true,
        "contentId": "logo",
        "downloadUrl": "/api/integrations/messages/60862da5-9a2f-411a-89a3-d54147793789/attachments/8c31069b-e5c5-4900-bc97-b0fc77baab22",
        "security": {
          "status": "clean",
          "accessAllowed": true,
          "threatName": null,
          "scannedAt": "2026-11-11T19:00:02.000Z"
        }
      }
    ],
    "attachmentCount": 1,
    "hasAttachments": true
  }
}
```

- `messageAt`: data da mensagem registrada pelo APMail (cabeçalho/envelope conforme o processamento atual). `receivedAt`: momento de persistência local, não uma data de entrega remota inventada. Datas ISO 8601 em UTC.
- `isRead`: leitura individual da mensagem para o usuário consultado, conforme o estado do atendimento. Ler pela API não modifica esse estado.
- `status`: estado real do atendimento (`to_reply`, `in_progress` ou `done`). `assignedTo` é UUID do responsável ou `null`.
- `body.html`: HTML original preservado nas novas ingestões quando disponível; em mensagens antigas sem original preservado, usa o HTML já armazenado. `originalAvailable` distingue os casos. `sanitizedHtml` fornece a versão sanitizada pelo APMail; campos sem conteúdo podem ser `null`.
- Assinatura, formatação, citações e encaminhamentos permanecem no corpo; não existe extração artificial da assinatura.
- Endereços não disponíveis (incluindo Bcc ausente no e-mail recebido) resultam em listas vazias. Não há prioridade fabricada.
- Imagens `cid:` devem ser relacionadas a `attachments[].contentId`. Baixe os bytes no backend, com autenticação, e entregue ao seu frontend pelo mecanismo protegido do seu sistema.
- Nenhum caminho físico, credencial, nota interna ou conteúdo de outro tenant é exposto.

**HTML recebido é conteúdo não confiável.** Sanitize antes de renderizar e utilize isolamento apropriado, bloqueando scripts, formulários e conteúdo ativo. Evite carregar imagens remotas automaticamente. Não coloque o token em URLs de imagens ou anexos.

## Listar e recuperar mensagens por cursor

`GET /api/integrations/messages?email=USUARIO&limit=25&mailboxId=UUID&cursor=CURSOR`

- Omita `messageId` para listar **mensagens recebidas**; `mailboxId` é opcional e filtra uma caixa. `limit` varia de 1 a 100, padrão 25.
- A primeira consulta sem cursor percorre as mensagens recebidas disponíveis desde o início, incluindo antigas/históricas. O detalhe pode consultar também uma mensagem enviada, caso seja permitida.
- Retorno: `{"success":true,"data":{"items":[...],"nextCursor":"...","hasMore":false}}`. Cada item segue o mesmo contrato de mensagem, mas com `body: null` e `bodyIncluded: false`, evitando carregar corpos inteiros na listagem. Use o GET de detalhe para conteúdo.
- Consuma enquanto `hasMore` for `true`. Persista `nextCursor` somente após processar os itens com sucesso. Quando for `false`, guarde o cursor e reutilize-o nas próximas consultas periódicas para receber novas mensagens.
- O cursor usa uma sequência persistente por tenant, coordenada com os commits das mensagens. Não depende da data declarada pelo remetente e não salta uma transação que ainda não foi confirmada.
- O cursor está vinculado ao token, usuário e filtro de caixa. Não o interprete ou altere. Ao mudar usuário, filtro ou chave, comece outra sequência. Mudanças de permissões não reapresentam automaticamente mensagens antigas: reinicie sem cursor se precisar reconciliar o novo escopo.
- A listagem não é um histórico de edições, exclusões, leitura ou mudança de status. Uma mensagem que deixou de existir ou de ser permitida não será retornada. Deduplicate por UUID interno (`id`).

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=usuario@empresa.com.br' \
  --data-urlencode 'limit=100' \
  --data-urlencode "cursor=$APMAIL_CURSOR"
```

## Baixar anexos

`GET /api/integrations/messages/:messageId/attachments/:attachmentId?email=USUARIO`

Requer `attachments:download`. A permissão `messages:read` sozinha não autoriza arquivos; a permissão de arquivos pode ser concedida separadamente. Tenant, usuário, caixa e mensagem são novamente verificados.

```bash
curl --get 'https://app.apmail.com.br/api/integrations/messages/60862da5-9a2f-411a-89a3-d54147793789/attachments/8c31069b-e5c5-4900-bc97-b0fc77baab22' \
  --header "Authorization: Bearer $APMAIL_API_TOKEN" \
  --data-urlencode 'email=usuario@empresa.com.br' \
  --output logo.png
```

O retorno é binário, transmitido em stream, com MIME e `Content-Disposition`. O `downloadUrl` do JSON é relativo à instalação e exige acrescentar `email` e o cabeçalho Bearer. Arquivos pendentes de análise, infectados ou com falha de segurança são bloqueados conforme o mecanismo de antivírus do APMail. A API não publica URLs permanentes sem autenticação e não inclui anexos em Base64.

## Receber webhooks

O APMail envia `POST` à URL configurada, depois de persistir uma mensagem recebida nova, não histórica, via IMAP/POP3. Importações históricas, mensagens enviadas e cópias feitas pelo mecanismo de transferência entre caixas não disparam `email.received`. Uma nova cópia sincronizada do mesmo Message-ID na mesma caixa não gera outra entrega para o mesmo webhook. Mensagens sem Message-ID utilizam a identidade gerada pelo processamento atual do APMail.

Cabeçalhos:

```http
Content-Type: application/json
X-APMail-Timestamp: 1794423600
X-APMail-Event-Id: UUID_DO_EVENTO
X-APMail-Signature: sha256=HEXADECIMAL_HMAC
```

Corpo:

```json
{
  "event": "email.received",
  "eventId": "99f94542-aa5b-479d-8374-06cb3e1b8764",
  "timestamp": "2026-11-11T19:00:00.000Z",
  "test": false,
  "data": {
    "id": "60862da5-9a2f-411a-89a3-d54147793789",
    "...": "mesmo contrato do GET de detalhe"
  }
}
```

O exemplo abrevia `data`; a entrega real utiliza o mesmo serializador do GET completo. No webhook `data.isRead` é **`null`**, porque o evento pertence à caixa e não representa a leitura de um usuário. Consulte o GET com `email` se precisar desse estado.

O limite do payload é 2 MiB. Se o corpo exceder esse limite, `data.body` será `null` e `data.bodyIncluded` será `false`; os identificadores e metadados permanecem e o conteúdo pode ser obtido pelo GET autenticado. Se mesmo os metadados excederem o limite, a entrega registra `payload_too_large`. Arquivos nunca são incorporados ao evento. Um consumidor que utiliza apenas webhook pode receber os corpos dentro desse limite, mas precisará de token para recuperar conteúdo omitido e baixar anexos.

O botão **Testar envio** cria uma entrega assinada com `test: true` e `data: null`, sem expor um e-mail real. Também funciona com webhook desativado, por ser uma ação administrativa explícita. A entrega aparece no histórico e é processada em segundo plano.

### Validar HMAC

O segredo é a string copiada da configuração, usada diretamente como chave UTF-8. Calcule:

```text
HMAC-SHA256(segredo, timestamp_do_cabeçalho + "." + corpo_HTTP_bruto)
```

Não reformate o JSON antes de validar. Exemplo Node.js no servidor consumidor:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function validAPMailWebhook(rawBody, headers, secret) {
  const stamp = headers['x-apmail-timestamp'];
  const signature = headers['x-apmail-signature'];
  if (typeof stamp !== 'string' || !/^\d{10,12}$/.test(stamp)) return false;
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(stamp)) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(stamp + '.')
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature.slice(7), 'hex');
  return timingSafeEqual(expected, received);
}
```

Capture `rawBody` como bytes antes do parser JSON do framework. Use comparação em tempo constante, mantenha relógio sincronizado, valide `event` e `test` e deduplicate `eventId` em armazenamento persistente. Só depois processe o conteúdo. Compare também o identificador do cabeçalho com `eventId` no corpo autenticado.

### Entregas e falhas

- Entrega **pelo menos uma vez**: o mesmo evento pode reaparecer se a resposta se perder. `eventId` permanece estável nos reenvios; o timestamp/assinatura do cabeçalho são renovados por tentativa. Responda `2xx` rapidamente após aceitar/persistir o evento e processe tarefas demoradas em background.
- Até 5 tentativas automáticas, com intervalos de 1 minuto, 5 minutos, 15 minutos e 1 hora. Timeout HTTP de 10 segundos e DNS de 3 segundos. Respostas não `2xx`, inclusive redirecionamentos, são falhas.
- O worker consulta entregas persistidas a cada 15 segundos. Redis coordena o processamento; o banco mantém pendências, leases, tentativas e resultados para recuperação após reinício/perda dos jobs.
- O histórico mostra estado, horários, HTTP, motivo resumido e tentativas, sem armazenar corpos de e-mail ou respostas do destino nos logs. Reenviar pelo painel abre um novo ciclo de até 5 tentativas, preservando o identificador e o histórico anterior.
- Alterar configuração, desativar ou rotacionar segredo cancela pendências da versão anterior, evitando enviá-las a outro destino/segredo por engano. O administrador pode avaliar e reenviar uma entrega cancelada. Requisições que já estão em trânsito podem terminar; a revogação impede novas tentativas.
- Apenas destinos HTTPS públicos na porta 443, com TLS válido. IPs privados/reservados, credenciais na URL e redirecionamentos são bloqueados. A resolução DNS é verificada novamente a cada envio e a conexão usa o IP validado.
- Se a mensagem for excluída/retida, a caixa deixar de ser monitorada ou o tenant for suspenso antes da entrega, o conteúdo não é exportado. Exclusões não são um evento desta versão.

## Erros e limites da API

Erros seguem o padrão do APMail: `{"error":{"code":"...","message":"..."}}`, podendo incluir detalhes de validação.

| HTTP | Situação                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Parâmetro ou cursor inválido (`invalid_cursor` para cursor inválido/contexto diferente).                                                                                        |
| 401  | Bearer ausente, inválido, expirado, revogado ou empresa indisponível (`invalid_integration_token`).                                                                             |
| 403  | Permissão da rota ausente (`integration_route_forbidden`), produção sem HTTPS (`https_required`) ou arquivo em quarentena (`file_infected`).                                    |
| 404  | Usuário inexistente/não autorizado (`notification_scope_unavailable`) ou mensagem/anexo fora do escopo/inexistente (`not_found`). Não diferencia usuário oculto de inexistente. |
| 409  | Anexo pendente de análise (`file_pending`) ou falha na verificação (`file_scan_error`).                                                                                         |
| 429  | Limite de consultas atingido. Respeite `Retry-After` quando presente e use backoff.                                                                                             |
| 5xx  | Falha temporária. Preserve cursor/eventos aceitos e tente novamente com backoff.                                                                                                |

Conteúdo e arquivos: limite de 300 consultas/minuto por token. Notificações mantêm o limite existente de 1.200/minuto por token. Não registre tokens ou conteúdo pessoal em mensagens de diagnóstico. Em indisponibilidade, preserve o funcionamento principal do sistema consumidor e recupere mensagens usando o último cursor confirmado.

## Implantação

As migrations `0079_external_mail_integrations.sql` e `0080_integration_delivery_event_index.sql` criam concessões por caixa, registro sequencial de mensagens, configurações e entregas de webhook, a coluna de HTML original e o índice de relacionamento das entregas para a limpeza de mensagens. Não ampliam permissões de tokens existentes e não disparam webhooks de mensagens antigas no backfill. API e worker executam as migrations versionadas no início em produção, pelo mecanismo existente. É necessário atualizar **API e worker**, além do frontend. Sem worker atualizado, GET funciona, mas as entregas ficam pendentes até o processamento estar disponível.
