# Identificação SMTP e HostGator

O registro `H=([127.0.0.1]) [177.145.219.214]` contém duas informações: a identificação EHLO/HELO enviada pela aplicação e o IP público observado pelo provedor. No exemplo, o IP de saída já é público. O Nodemailer usa `[127.0.0.1]` quando o nome da máquina não é um domínio completo, situação comum em contêineres sem a opção `name` configurada. A HostGator informou que seu filtro pode descartar mensagens nessa condição mesmo após aceitar a submissão SMTP.

O APMail agora define explicitamente `name` em todos os transportes reais: envio da caixa (incluindo respostas, agendamentos, MDN e ICS), mensagens do sistema e teste de conexão na API. O destino `smtp_host`, a porta, a autenticação e o TLS do provedor permanecem configurados como antes.

## Configuração

- Com `SMTP_EHLO_NAME` vazio, o nome é obtido automaticamente do hostname de `APP_URL`. Por exemplo, `APP_URL=https://app.apmail.com.br:75` resulta em `EHLO app.apmail.com.br`.
- Se necessário, use `SMTP_EHLO_NAME=app.apmail.com.br`, com um domínio público real da instalação. O valor não recebe `https://`, porta ou caminho. Ele precisa ter DNS válido; o APMail valida o formato, sem impor consulta DNS adicional a cada mensagem.
- Também é permitido um IP público conhecido da instalação. IPv4 e IPv6 são convertidos em literais SMTP apropriados (`[IPv4]` ou `[IPv6:endereço]`). Endereços privados, loopback, nomes locais, nomes simples de contêiner e caracteres de controle são rejeitados.
- O Compose passa a variável para API e worker. Não é necessário alterar o banco nem reconectar as caixas existentes. Após publicar a versão corrigida, recrie os serviços API e worker para carregar o código e a configuração.
- Em produção com `APP_URL` local/privado, configure explicitamente a identificação pública. Para servidores de teste locais, desenvolvimento/teste conservam a identidade fixa `apmail.test`.

Não é necessário consultar serviços de descoberta de IP: o SMTP já identifica o IP de origem da conexão, e o hostname público é a identificação preferencial do cliente. A correção não modifica DNS, SPF, DKIM, DMARC ou o IP de saída/NAT.

## Validação e entrega

Os testes locais usam servidor SMTP real que rejeita saudações locais ou inválidas e registra o EHLO recebido. Cobrem mensagens enfileiradas, resposta para destinatário de outro domínio com In-Reply-To preservado, SMTP global, identificação automática, substituição explícita e verificação SMTP/POP3 da API. Os endereços externos nos testes são apenas envelopes capturados pelo servidor local; nenhuma mensagem desses testes é entregue ao Gmail ou à HostGator.

Depois da atualização em produção, confira com o provedor uma nova tentativa autorizada: o log deve apresentar o domínio configurado em `H=(...)`, com o IP público da conexão separado. A confirmação SMTP de aceitação não comprova entrega na caixa do destinatário; se persistir o descarte, encaminhe ao provedor horário, destinatário e Message-ID para conferir o filtro. Mensagens anteriormente aceitas não são reenviadas automaticamente, para evitar duplicação.

Referências: [Nodemailer: opções de conexão SMTP](https://nodemailer.com/smtp#connection-options) e [RFC 5321, EHLO/HELO](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.1.1.1).
