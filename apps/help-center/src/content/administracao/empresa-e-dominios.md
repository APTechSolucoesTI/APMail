---
title: Empresa e domínios
description: Revise dados da empresa e consulte os registros DNS associados aos domínios de e-mail.
audience: Administrador
readingTime: 6
updatedAt: 26 de novembro de 2026
keywords: empresa, domínio, DNS, MX, SPF, DMARC, DKIM, armazenamento, contatos
prerequisites: Permissão de administração da empresa e de domínios
related: administracao/caixas-de-email, primeiros-passos/jornada-administrador, administracao/equipe-e-perfis
---

As configurações da empresa definem informações organizacionais e alguns padrões usados por novas caixas e contatos.

![Painel Administrativo do APMail com dados anonimizados](/images/screenshots/admin.jpg)

## Atualizar os dados da empresa

Abra **Painel Administrativo → Empresa**. Revise nome, dados cadastrais, endereço, contato, fuso horário, padrões de e-mail e opções de agenda de contatos que estiverem disponíveis.

Alterar o padrão de agenda não converte contatos já cadastrados.

## Consultar um domínio

Em **Painel Administrativo → Domínios**, cadastre o domínio e abra seu diagnóstico para consultar MX, NS, SPF, DMARC e DKIM. Para DKIM, informe o seletor publicado pelo provedor.

Esses resultados são consultivos. O APMail não altera registros DNS e a presença de um registro não comprova entrega ou autenticação final de uma mensagem.

## Distribuir armazenamento

Na configuração da empresa, o proprietário ou administrador pode distribuir a cota disponível entre as caixas no modo automático ou personalizado, conforme as opções apresentadas.

:::warning Alterações de política
Opções que afetam a empresa inteira — como filas, contatos globais e armazenamento — devem ser revisadas antes de salvar. Confirme o escopo mostrado na tela.
:::
