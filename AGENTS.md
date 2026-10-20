# Contexto operacional do APMail

## Repositório e publicação

- Repositório local: `E:\Sistemas\APMail`; branch de entrega: `main`.
- O usuário solicitou commit e push das alterações relacionadas a cada entrega.
- O usuário cuida do Dokploy. Não fazer deploy sem solicitação explícita.
- Preservar alterações locais e dados existentes, salvo limpeza expressamente autorizada.

## Instalação atual

- Aplicação: `https://app.apmail.com.br`.
- Servidor SSH: `192.168.3.106:22`, usuário `administrador`.
- Projeto Compose: `apmail-next-production-qrufqc`.
- Banco da aplicação: `apmail`, no container Postgres desse projeto.
- Armazenamento: volume `apmail-next-production-qrufqc_storage`, montado em `/data/storage`.
- Empresa APTech: `82be82c6-f7b1-4ad4-bee5-05729e75ac94`, slug `aptech`.
- Administração da plataforma: `sistema@aptechinfo.com.br`.
- Acesso operacional do usuário: `gabriel.teixeira@aptechinfo.com.br`.
- Caixas de teste atuais da APTech: `comercial1@aptechinfo.com.br` e `financeiro2@aptechinfo.com.br`.
- Ambas usam `mail.aptechinfo.com.br`: IMAP 993/TLS e SMTP 465/TLS.
- Conferir nomes, containers, tenant e mounts antes de qualquer operação de manutenção.
- Há outros produtos nesse servidor. Nunca limpar volumes, bancos ou filas de outro projeto.

## Acesso protegido nesta estação

O usuário pediu para preservar o acesso fornecido. As credenciais ficam fora do Git,
criptografadas com Windows DPAPI e vinculadas ao usuário desta estação:

- SSH: `$env:USERPROFILE/.codex/private/apmail-192.168.3.106-ssh.xml`.
- Aplicação: `$env:USERPROFILE/.codex/private/apmail-application.xml`.

Use `Import-Clixml` em PowerShell para carregar os objetos protegidos. Nunca imprima
senhas, cookies, chaves ou objetos de credenciais completos; não copie esses arquivos
para o repositório nem registre valores em documentação. Quando o arquivo existir,
teste o acesso autorizado antes de pedir novamente a mesma credencial.

Fingerprint ED25519 já conferido no `known_hosts` desta estação:
`SHA256:+OYopXHSMR0vHLMq5JmD+k2m8p+GG5UTv9Yy2YGNWNw`.

## Limpeza de dados

- Exigir alvo exato e solicitação explícita do usuário.
- Limpeza no APMail não autoriza exclusão de mensagens no provedor IMAP/POP3.
- Preservar usuários, acesso administrativo, schema e migrations quando o pedido for zerar uma tenant.
- Parar o processamento e bloquear temporariamente o acesso operacional durante a limpeza.
- Conferir backup, dependências, caminhos reais dos arquivos e registros de outras empresas.
- Não usar `scripts/reset-production-data.mjs` para zerar uma tenant: ele reinicializa toda a instalação.
- Remover tarefas antigas das filas por identificadores da tenant; não usar `FLUSHDB` global.
- Verificar liberação física do espaço, não apenas ocultação ou exclusão lógica.
- Retomar os mesmos serviços e conferir a aplicação após a manutenção.

Última limpeza autorizada: [20/10/2026](docs/OPERACAO-LIMPEZA-APTECH-2026-10-20.md).
