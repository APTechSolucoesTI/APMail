---
title: Gerenciar caixas de e-mail
description: Conecte caixas, configure acesso e consulte o estado de sincronização.
audience: Administrador
readingTime: 7
updatedAt: 26 de novembro de 2026
keywords: caixa, IMAP, POP3, SMTP, local, conectar, senha de aplicativo, pastas, importação
prerequisites: Endereço de e-mail existente no provedor e permissão de gerenciamento
related: primeiros-passos/jornada-administrador, administracao/equipe-e-perfis, ajuda/problemas-comuns
---

O APMail conecta endereços que já existem no provedor. A criação de uma caixa na aplicação não cria uma conta de hospedagem.

## Conectar uma caixa

Abra **Painel Administrativo → Caixas de e-mail** e selecione **Conectar caixa de e-mail**. Escolha o protocolo disponível:

- **IMAP e SMTP:** sincroniza mensagens e usa o servidor de envio configurado.
- **POP3 e SMTP:** recebe mensagens sem apagá-las no provedor; pastas, movimentos e exclusões são locais.
- **Arquivo local:** consulta mensagens importadas, sem conexão ao provedor e sem envio próprio.

Informe o nome da caixa, endereço, usuário, credenciais e servidores/portas exigidos. Use TLS e as credenciais de aplicativo recomendadas pelo provedor. Teste a conexão antes de salvar.

## Definir importação e filas

Na criação, escolha o período da importação inicial conforme as opções exibidas, como 30, 90 ou 180 dias, 1, 5 ou 10 anos, ou todo o histórico. A importação pode consumir armazenamento e levar tempo.

Configure se a caixa usa filas e o tipo de atendimento. O comportamento de conversas antigas não é reclassificado automaticamente ao alterar algumas políticas.

## Conceder acesso

Na caixa, abra **Membros** para escolher integrantes e papéis. Use **Pastas** para limitar a leitura quando necessário. Sem vínculo explícito não há acesso à caixa, mesmo para administradores da empresa.

## Editar a configuração

Em **Caixas de e-mail**, abra a caixa e consulte as abas **Conexão**, **Membros**, **Pastas**, **Regras**, **Envio** e **Importação e backup** conforme o protocolo e permissões.

:::warning Dados de conexão
Senhas de caixa são armazenadas de forma protegida e não devem ser registradas em documentação, capturas ou mensagens de suporte. Se uma credencial for comprometida, atualize-a no provedor e na configuração da caixa.
:::

## Acompanhar o estado

O estado pode indicar **Ativa**, **Verificando**, **Erro de conexão** ou **Desativada**. Em falhas temporárias, confira host, porta, TLS e credenciais antes de pedir alteração ao provedor.
