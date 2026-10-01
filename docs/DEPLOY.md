# Publicação do APMail

A stack de produção será concluída na Fase 9, conforme a seção 17 da especificação. A infraestrutura em execução nesta fase é exclusivamente de desenvolvimento.

Pré-requisitos de produção: domínio com DNS correto, HTTPS, SMTP para convites/redefinição, segredos de 32 bytes e backup de banco e anexos. Segredos nunca devem ser registrados no repositório.

Será criado projeto APMail no Dokploy usando Docker Compose, branch main e serviço web na porta interna 80. Banco e Redis serão exclusivos, sem portas públicas no Compose principal.
