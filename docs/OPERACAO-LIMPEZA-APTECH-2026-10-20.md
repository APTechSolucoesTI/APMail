# Limpeza autorizada da APTech — 20/10/2026

Operação concluída na instalação `https://app.apmail.com.br`, por solicitação
expressa do usuário. Alvo: APTech, ID `82be82c6-f7b1-4ad4-bee5-05729e75ac94`.
Nenhum dado de outro produto do servidor foi alterado.

## Resultado

- Removidas as sete caixas antigas, incluindo registros já excluídos e solicitações de limpeza pendentes.
- Excluídas 14.266 mensagens, 29.810 anexos, 6.955 conversas de e-mail e o restante dos dados operacionais da empresa.
- Zerados contatos, etiquetas de ambos os usuários, regras, assinaturas, rascunhos/envios,
  agenda, lembretes, chat, importações, exportações e notificações anteriores.
- Removidos fisicamente 43.970 arquivos: 18.751.899.667 bytes de conteúdo,
  correspondentes a 18.852.163.584 bytes alocados no volume.
- Removidos 132 jobs antigos e dois agendadores das caixas anteriores, sem `FLUSHDB`.
- Compactadas as tabelas principais: banco passou de 321.681.075 para 42.579.635 bytes
  na conferência imediatamente anterior à retomada do worker.
- Preservados usuários, senhas, vínculos, papéis, identidade da empresa, configuração
  de infraestrutura, limites de armazenamento, schema, migrations e auditoria da plataforma.
- Nenhuma mensagem foi apagada no provedor HostGator.

## Novas caixas

| Nome         | Endereço                      | Recebimento  | Envio        |
| ------------ | ----------------------------- | ------------ | ------------ |
| Comercial 1  | comercial1@aptechinfo.com.br  | IMAP 993/TLS | SMTP 465/TLS |
| Financeiro 2 | financeiro2@aptechinfo.com.br | IMAP 993/TLS | SMTP 465/TLS |

Servidor de ambas: `mail.aptechinfo.com.br`. Credenciais persistidas pela API existente,
com criptografia habitual, após autenticação IMAP e SMTP a partir do servidor.
Gabriel e Henrique mantêm acesso administrativo às duas caixas.

As duas ficaram ativas e sincronizaram. Cada conta já continha uma mensagem de
configuração do cPanel no provedor; essas duas mensagens entraram pela sincronização
normal, depois da limpeza. Não são dados antigos da tenant e não foram enviadas por esta operação.
Nenhum e-mail de teste foi enviado.

## Procedimento e validação

O worker foi parado e a empresa foi temporariamente suspensa para impedir alterações
durante a manutenção. Foi criado um dump PostgreSQL, conferido com `pg_restore --list`
e checksum SHA-256. Os caminhos reais e a propriedade dos arquivos foram verificados
antes da exclusão, limitada às pastas da tenant no volume do APMail.

A exclusão foi validada em transação revertida antes da execução definitiva. Índices
auxiliares temporários aceleraram os triggers existentes e foram removidos na mesma
transação; constraints e triggers permaneceram habilitados. Não houve mudança
permanente de schema nem execução de migration.

Foram conferidos no banco os dados zerados e a preservação dos usuários e vínculos.
As APIs confirmaram contatos, etiquetas, regras, rascunhos, lembretes e exclusões
pendentes vazios. Reconciliação completa terminou com nove arquivos conferidos e
zero erros após a sincronização das caixas novas.

API e worker foram retomados nas mesmas imagens, sem deploy. Saúde da aplicação,
PostgreSQL e Redis: OK. No navegador, as duas caixas apareceram ativas e suas entradas
abriram corretamente com a conta operacional de Gabriel. Não foram observados erros
JavaScript da aplicação. O console registrou o bloqueio do beacon externo do Cloudflare
pela CSP existente; a política de segurança foi preservada.

Esta entrega altera dados e documentação operacional. Não altera código da aplicação;
lint, testes e build não foram repetidos para a documentação.

## Registro privado da operação

Backup **somente do banco**, manifestos e resultado ficam no servidor em:
`/home/administrador/apmail-next/.data/operations/aptech-reset-20261020/`.
Os arquivos apagados do armazenamento não foram duplicados nesse backup.
Os scripts pontuais e evidências locais ficam em `.data/qa/`, fora do Git.

Os acessos fornecidos foram guardados fora do repositório com Windows DPAPI;
o contexto e os caminhos seguros estão em [AGENTS.md](../AGENTS.md).
