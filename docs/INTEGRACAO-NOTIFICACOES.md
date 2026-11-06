# API de notificações para integrações

Depois do deploy, a consulta é `GET https://app.apmail.com.br/api/integrations/notifications?email=usuario%40empresa.com.br`.

No painel administrativo, abra Integrações e a aba Tokens de API. Crie um token com um nome, selecione os usuários autorizados e escolha validade de 30, 90 ou 365 dias. O segredo aparece uma única vez. Guarde-o em uma variável de ambiente no backend do sistema integrado. Renovar invalida o segredo anterior imediatamente e gera outro válido por 90 dias. Revogar encerra o acesso.

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
    "hasNotifications": true
  }
}
```

`unread` conta mensagens recebidas depois do último registro de leitura daquela conversa pelo próprio usuário. A leitura de outra pessoa não altera esse contador. Abrir uma conversa no APMail marca suas mensagens como lidas conforme o fluxo atual. A consulta da integração não altera a leitura, as mensagens ou os atendimentos.

`pending` conta conversas visíveis em A Responder ou Em Atendimento. Inclui caixas com filas ocultas, pois o atendimento continua disponível nelas. Conversas excluídas das filas não entram nesse total. Os campos são independentes e podem representar a mesma conversa. Não devem ser somados.

As contagens respeitam o usuário autorizado pelo token, seu perfil, os vínculos explícitos com caixas, as pastas e subpastas permitidas, a restrição de operadores e os convites ativos. Lixeira, spam, mensagens retidas e registros excluídos ficam fora. Confirmações de leitura seguem o critério existente de mensagens não lidas. O e-mail do usuário é normalizado para minúsculas. O tenant vem exclusivamente do token, independentemente da empresa selecionada em sessões interativas.

As respostas usam `Cache-Control: no-store`. O token permite apenas esta consulta, sem ler conteúdo ou operar outras APIs. O banco guarda SHA-256 do segredo aleatório. Criação, renovação e revogação são auditadas. O limite é de 1.200 consultas por minuto por token, compartilhado pelo Redis entre instâncias. Credenciais inválidas têm um limite separado de 60 tentativas por minuto por IP. Não há cache de contagens no servidor.

Os erros seguem `{"error":{"code":"...","message":"..."}}`. Um e-mail inexistente, fora da lista, desativado ou sem acesso ao módulo recebe a mesma resposta 404. A API não distingue esses casos.

| HTTP                 | Tratamento no sistema integrado                                                       |
| -------------------- | ------------------------------------------------------------------------------------- |
| 400                  | Conferir o formato do e-mail enviado.                                                 |
| 401                  | Token ausente, inválido, expirado ou revogado. Corrigir a configuração da integração. |
| 403                  | Usar HTTPS em produção.                                                               |
| 404                  | O usuário não está disponível no escopo autorizado. Ocultar a contagem.               |
| 429                  | Respeitar o cabeçalho Retry-After.                                                    |
| 5xx ou falha de rede | Exibir indisponibilidade discreta e tentar novamente no próximo ciclo.                |

A API exige HTTPS em produção. O proxy reverso do ambiente deve ser o único acesso externo ao backend e informar o protocolo original. O log de acesso web omite os parâmetros da URL, e o logger da API oculta Authorization e cookies.

## Implementação no Curciol

Crie uma rota autenticada no backend do Curciol que consulte a API com o e-mail da sessão atual. O navegador chama somente essa rota local. Use `APMAIL_API_BASE_URL=https://app.apmail.com.br` e `APMAIL_INTEGRATION_TOKEN` como configuração privada do servidor. Não receba um e-mail arbitrário do navegador para consultar outra pessoa.

Atualize ao entrar e a cada 60 segundos, com timeout de 5 segundos e uma requisição por vez. Pause consultas quando a página estiver oculta e retome ao voltar. Use um badge com `unread` e um tooltip que apresente separadamente as conversas pendentes. Quando somente `pending` for positivo, mostre um ponto discreto. O clique abre `https://app.apmail.com.br` em outra aba com `noopener`.

Durante indisponibilidade, mantenha a última contagem com indicação discreta de desatualização por até cinco minutos. Depois, apresente o indicador sem número. Uma falha não deve ser apresentada como zero nem impedir o uso do Curciol. Nunca registre o token ou o e-mail consultado em logs rotineiros.
