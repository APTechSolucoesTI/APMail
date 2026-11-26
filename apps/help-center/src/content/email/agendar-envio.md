---
title: Agendar um envio
description: Programe uma mensagem para ser enviada mais tarde ou em uma recorrência.
audience: Usuário
readingTime: 5
updatedAt: 26 de novembro de 2026
keywords: agendar, envio, recorrência, repetir, fila, falha
prerequisites: Permissão de envio na caixa
related: email/enviar-responder-encaminhar, produtividade/preferencias-e-atalhos
---

Use o agendamento quando a mensagem precisar sair em um horário específico ou em uma série recorrente.

## Agendar a primeira ocorrência

No compositor, prepare destinatários, assunto, conteúdo e anexos. Abra o menu de envio e selecione **Agendar envio**. Escolha data, horário e fuso quando solicitado.

Se precisar, habilite **Repetir este envio** e selecione horas, dias, semanas ou meses. A série pode não ter término, terminar em uma data ou após uma quantidade de envios.

## Acompanhar agendamentos

Abra **Envios e agendamentos**. As abas são:

- **Agendados:** próximos envios e séries ativas.
- **Na fila:** ocorrências prontas para processamento.
- **Com falha:** mensagens que precisam de nova tentativa.

O servidor e o worker continuam processando agendamentos mesmo que você feche o navegador depois que o trabalho entrou na fila.

## Parar uma série

Na lista de agendamentos, use a ação para parar os próximos envios. Ocorrências já iniciadas podem terminar; mensagens enviadas não são desfeitas.

:::info Recorrência
O sistema não cria uma rajada de mensagens atrasadas quando o servidor fica indisponível. Depois de uma ocorrência, calcula o próximo horário futuro.
:::

## Se houver falha

Leia o motivo exibido em **Com falha**, corrija a permissão, a conexão ou o anexo e selecione **Tentar novamente**. Uma mensagem já confirmada como enviada não é reenviada apenas para avançar a próxima ocorrência.
