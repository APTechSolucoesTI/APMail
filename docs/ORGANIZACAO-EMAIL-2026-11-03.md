# Organização de e-mails e composição

- Arrastar diretamente o e-mail da lista ou o assunto da conversa aberta move para uma pasta da mesma caixa. A seleção em lote acompanha o arraste e é limpa após sucesso. Há indicação de origem/destino e suporte à redução de movimento.
- Arrastar o cabeçalho de uma caixa muda sua ordem pessoal. Quando agrupadas por domínio, caixas são reordenadas dentro do domínio, preservando os demais grupos.
- Arrastar uma pasta muda somente sua ordem entre irmãs reais. Não altera a hierarquia. `Alt` + seta para cima/baixo é a alternativa por teclado nos links de caixas e pastas.
- O menu de três pontos oferece **Mover para…**, inclusive para a raiz. API e worker validam ciclos, conflitos, permissões e compatibilidade entre pastas locais e do servidor, preservando IDs e mensagens.
- A estrela cria/remove um atalho em **Favoritos** dentro da própria caixa. Ordem e favoritos persistem por usuário e empresa no banco; não modificam a preferência de outras pessoas.
- O cabeçalho do compositor pode ser arrastado sem ícone adicional. O título aceita setas pelo teclado, `Shift` para passos maiores e `Home` para restaurar. A posição e a largura do menu são preferências locais por usuário; a posição respeita os limites da tela e o compositor ocupa a tela em dispositivos menores.
- **Para**, **Cc** e **Cco** abrem pesquisa paginada da agenda, com seleção de múltiplos endereços. É possível criar contato ou adicionar endereço ao contato existente, conforme as permissões, e usar o endereço na mensagem.
- A caixa de entrada oferece lixeira discreta por linha, vermelha ao passar o mouse. Move imediatamente o e-mail/conversa para a Lixeira, sem exclusão definitiva. A seleção e o detalhe mostram **Mover para pasta** e **Excluir** diretamente.
- Novas importações usam mensagens lidas e permitem escolher ordem original do arquivo/Outlook ou alfabética. A ordem exata do Outlook depende dos metadados presentes no backup. Pastas preexistentes e conversas previamente não lidas não são reescritas; novos e-mails continuam seguindo o comportamento normal de leitura.

## Persistência e operação

Migrations aditivas `0069_archive_order.sql` e `0070_personal_mail_navigation.sql`, com tipos gerados. Preferências de navegação usam `mail_navigation_preferences`, com chave por empresa/usuário e RLS; a API valida acesso a cada caixa/pasta. Não há dependências novas.

Ambas as migrations foram aplicadas em 03/11/2026 no banco `apmail` do projeto `apmail-next-production-qrufqc`, após conferir checksums e salvar o esquema em `/home/administrador/apmail-next/.data/backups/mail-organization-20261103T174938Z/schema-before.sql`. Nenhum deploy foi executado.

Verificação: lint, typecheck e build; testes unitários e integrações em PostgreSQL/Redis exclusivos de teste; fluxos no navegador em 1440×900, 768×1024 e 390×844, claro/escuro. Arrastes diretos, lixeira rápida, ações expandidas, movimentação de pasta e persistência foram executados. Nenhum e-mail real foi enviado. O caminho IMAP de renomeação foi validado com transporte simulado, sem mover pastas reais do provedor. Dois testes nativos de exportação PST permaneceram ignorados por ausência do exportador nessa execução; os testes do parser de importação foram executados diretamente.
