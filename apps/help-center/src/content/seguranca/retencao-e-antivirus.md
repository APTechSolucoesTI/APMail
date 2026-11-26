---
title: Retenção de e-mails e antivírus
description: Recupere mensagens removidas e entenda a proteção aplicada a anexos.
audience: Administrador
readingTime: 6
updatedAt: 26 de novembro de 2026
keywords: retenção, lixeira, restaurar, excluir definitivamente, antivírus, quarentena, anexo
prerequisites: Permissões de retenção ou antivírus
related: email/ler-e-organizar, email/anexos-e-seguranca, administracao/equipe-e-perfis
---

As áreas **E-mails em retenção** e **Antivírus** ficam no Painel Administrativo e exigem permissões específicas.

## Restaurar uma mensagem retida

Abra **Painel Administrativo → E-mails em retenção**. Pesquise por assunto, caixa, usuário ou período. Abra a mensagem e use **Restaurar** para devolvê-la à pasta de destino indicada.

A retenção padrão é configurável pela empresa e pode variar. O APMail não remove uma mensagem diretamente do servidor IMAP por mover para a Lixeira local.

## Excluir definitivamente

A ação de expurgo é irreversível e exige a permissão **retention.purge** e confirmação adicional. Confira o filtro e a quantidade de registros antes de confirmar.

## Consultar arquivos analisados

Em **Painel Administrativo → Antivírus**, consulte as abas de estado, arquivos, ameaças, histórico, remetentes confiáveis e decisões, conforme as permissões concedidas.

Administradores autorizados podem liberar um falso positivo com justificativa ou cadastrar uma regra de confiança por remetente, caixa e validade.

:::warning Liberação é uma decisão de segurança
Liberar um arquivo pode permitir download, prévia, envio e exportação. Faça a avaliação da origem e do conteúdo antes de confirmar.
:::

## Se um arquivo estiver em quarentena

Não tente abrir o arquivo fora do APMail. Solicite que um administrador autorizado revise o resultado do antivírus e registre a justificativa antes de liberar.
