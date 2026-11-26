---
title: Tokens de API e Webhooks
description: Configure integrações servidor a servidor sem expor segredos no navegador.
audience: Administrador
readingTime: 7
updatedAt: 26 de novembro de 2026
keywords: integração, API, token, webhook, HMAC, mensagens, notificações
prerequisites: Permissão de integrações e endpoint HTTPS público para webhooks
related: administracao/equipe-e-perfis, seguranca/retencao-e-antivirus
---

As integrações são administradas em **Painel Administrativo → Integrações**. Tokens de API e Webhooks são recursos independentes.

## Criar um token de API

Na aba **Tokens de API**, selecione **Criar token**, informe o nome e a validade e escolha os acessos necessários. As permissões de notificações, leitura de mensagens e download de anexos podem ser configuradas separadamente.

O segredo completo aparece uma única vez. Copie-o diretamente para um cofre de segredos do sistema consumidor.

:::warning Proteja o token
Não coloque tokens em JavaScript do navegador, URL, logs, repositório, documentação ou capturas. Se houver suspeita de exposição, revogue ou rotacione o token imediatamente.
:::

## Criar um Webhook

Na aba **Webhooks**, informe nome, URL HTTPS pública, caixas monitoradas e eventos **email.received** e/ou **email.sent**. Guarde o segredo HMAC mostrado uma única vez.

Use **Testar envio** para criar uma entrega de teste sem expor uma mensagem real. Consulte o histórico para verificar tentativas e resposta HTTP.

## Validar a assinatura

O sistema consumidor deve validar a assinatura HMAC-SHA256 sobre o timestamp e o corpo HTTP original, comparar o segredo em tempo constante e rejeitar solicitações antigas. Persista o identificador do evento para evitar processá-lo duas vezes.

## Acompanhar falhas

O histórico mostra estado, horário e motivo resumido. Entregas podem ser repetidas conforme a política de tentativas. Atualizar ou desativar um webhook cancela pendências da configuração anterior para evitar entrega acidental a outro destino.

:::info Entrega pelo menos uma vez
O mesmo evento pode ser recebido mais de uma vez. O sistema consumidor deve ser idempotente e responder rapidamente após aceitar o evento.
:::
