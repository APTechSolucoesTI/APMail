# Regras e respostas automáticas

Em **Configurações → Regras**, as regras pessoais organizam mensagens para o usuário.
As **Regras da caixa** controlam a organização compartilhada e as respostas automáticas;
exigem permissão de regras e, para responder, permissão de envio em uma conta conectada.
Caixas locais não enviam respostas.

## Configurar a ação de resposta automática

1. Abra **Regras da caixa → Nova regra**, dê um nome à regra e escolha a caixa.
2. Selecione **Todas as mensagens recebidas** ou escolha condições por remetente,
   destinatário, assunto, corpo ou anexos. Adicione exceções para ignorar casos específicos.
3. Em **Ação**, selecione **Responder automaticamente** e personalize o assunto e a
   mensagem. Sem assunto personalizado, a resposta usa “Resposta automática” seguido
   do assunto recebido. O texto pode ser um aviso de recebimento, de férias ou outra resposta fixa.
4. Configure o intervalo por remetente (padrão: sete dias) e, opcionalmente, início e término.
   As datas usam o fuso das preferências do usuário e são armazenadas como instantes UTC.
5. Salve a regra. O backend processa novas mensagens mesmo com o navegador fechado.

Sem datas, a regra continua funcionando até você desligar a chave na coluna **Ativa**.
Reative a mesma chave para voltar a responder, preservando o texto configurado.
As respostas automáticas usam o mesmo cadastro, condições e gerenciamento das demais regras.

O teste de condições usa uma conversa recebida e não executa ações nem envia e-mails.
Exceções são combinadas por “ou”; qualquer exceção correspondente impede a regra.
Prioridades menores são executadas antes; parar o processamento interrompe as regras
seguintes do mesmo escopo. Períodos e ativação são respeitados também no envio da resposta.

## Proteções e limites

- Respostas são produzidas apenas para mensagens novas da entrada, recebidas após a
  criação da regra. Importações e reaplicações em mensagens existentes não geram respostas.
- O destinatário é o Return-Path válido recebido, sem usar um Reply-To arbitrário.
  Pedidos sem Return-Path válido, retornos vazios, mensagens automáticas, listas,
  relatórios de entrega/leitura, spam, lixeira e endereços da própria caixa e seus aliases são ignorados.
  Um endereço da caixa ou alias precisa constar em Para/Cc.
- O intervalo é compartilhado entre todas as respostas automáticas da caixa, evitando
  múltiplas respostas ao mesmo remetente quando duas regras correspondem.
- A reserva do intervalo e a criação do envio são transacionais. A unicidade já existente
  da fila evita duplicação na reexecução do mesmo processamento; a recuperação da outbox
  cobre indisponibilidade temporária do Redis.
- O MIME inclui `Auto-Submitted: auto-replied` e `X-Auto-Response-Suppress: All`, com
  envelope SMTP de retorno vazio. A referência é a [RFC 3834](https://www.rfc-editor.org/rfc/rfc3834).
- A resposta não cita a mensagem original, não pede confirmação de leitura e não conta
  como resposta humana nas filas/SLA. O texto personalizado é escapado antes de compor HTML.
- Encaminhamento e resposta automática devem ficar em regras separadas.
- Não há envio retroativo. Reativar uma regra não dispara respostas para mensagens já processadas.

## Persistência

A migration `0047_rules_auto_reply.sql` preserva regras existentes, adiciona período e
exceções, registra a elegibilidade de resposta no recebimento e identifica envios automáticos.
`mail_auto_reply_state` mantém o intervalo por caixa/endereço, com chave única, vínculos
referenciais e contabilização no armazenamento existente. Não há novas credenciais ou serviços.
