---
title: Jornada do administrador
description: Configure uma operação nova no APMail na ordem recomendada.
audience: Administrador
readingTime: 8
updatedAt: 26 de novembro de 2026
keywords: administrador, configurar empresa, equipe, caixa, permissões, jornada
prerequisites: Convite ou acesso de administrador à empresa
related: administracao/empresa-e-dominios, administracao/caixas-de-email, administracao/equipe-e-perfis
---

Use esta sequência para preparar a operação sem deixar etapas importantes para trás. Os nomes dos menus podem não aparecer para pessoas sem a permissão correspondente.

![Painel Administrativo do APMail com dados anonimizados](/images/screenshots/admin.jpg)

## 1. Confira os dados da empresa

Abra **Configurações → Empresa** e revise o nome, os dados de identificação, o fuso e os padrões de e-mail. Na mesma área, confira a distribuição de armazenamento entre as caixas quando esse recurso estiver disponível.

## 2. Cadastre os domínios usados pela equipe

Em **Painel Administrativo → Domínios**, registre os domínios da empresa e use os diagnósticos de MX, NS, SPF, DMARC e DKIM como consulta. Esses diagnósticos não alteram o DNS e não comprovam a entrega de mensagens.

## 3. Conecte as caixas de e-mail

Abra **Painel Administrativo → Caixas de e-mail** e selecione **Conectar caixa de e-mail**. Escolha IMAP, POP3 ou caixa local, informe os dados exigidos pelo provedor e teste a conexão antes de salvar.

Defina o período da importação inicial, o tipo de atendimento, o uso de filas e quem poderá acessar a caixa. Para caixas IMAP, confirme também o envio SMTP.

## 4. Organize o acesso da equipe

Em **Painel Administrativo → Equipe e acesso**, convide cada pessoa com seu próprio endereço. Depois, atribua um perfil e conceda acesso explícito às caixas e, quando necessário, às pastas.

## 5. Ajuste perfis e permissões

Em **Perfis de acesso**, crie ou duplique um perfil conforme a responsabilidade. Em **Permissões por usuário**, use uma exceção apenas quando uma pessoa precisar de um conjunto individual de permissões.

Na caixa de e-mail, os papéis mais comuns são **Visualizador**, **Operador**, **Supervisor** e **Admin da caixa**.

## 6. Configure integrações e proteção

Em **Integrações**, configure Claude Opus 5.5, Tokens de API ou Webhooks somente se a operação precisar deles. Em **Antivírus**, confira o estado da análise de arquivos e as permissões para liberar ou confiar em remetentes.

## 7. Faça um teste controlado

Use endereços claramente identificados e autorizados. Confira o recebimento, responda uma conversa, atribua um responsável, adicione uma nota, crie uma tarefa e conclua o atendimento. Não envie mensagens de teste para terceiros sem consentimento.

:::tip Ordem recomendada
Primeiro prepare empresa, domínio e caixas. Depois convide a equipe e conceda acessos. Só então configure regras e integrações que dependam dessas caixas.
:::
