# Contatos e busca global — 06/10/2026

Implementação local revisada conforme o print enviado em 06/10/2026. Contatos usa o cabeçalho destacado, seleção de empresas no topo, chips com estrela, nome/cargo lado a lado, e-mails/telefones em seletores compactos e rodapé fixo. O APTicket foi somente referência visual; nenhum contato ou empresa externa foi importado.

## Cadastro e edição

- Empresa opcional no primeiro campo; depois nome, cargo, vários e-mails e telefones, com seleção dos principais por estrela. Removidos os campos de identificação e a escolha de destino: o formulário cria ou edita um contato.
- Cada e-mail aceita vários vínculos de empresa/endereço. Um endereço também pode existir sem empresa. A empresa principal é uma escolha única do contato, independente do e-mail principal.
- Empresas são selecionadas no cadastro próprio, mesmo quando ainda não têm contato. Busca única por CNPJ, razão social e nome fantasia; Enter seleciona uma empresa encontrada ou abre o cadastro consultando um CNPJ completo ainda não cadastrado. Selecionar uma empresa conserva sua identidade, inclusive sem CNPJ.
- Endereços, observações, vínculos específicos por e-mail e visibilidade aparecem sob demanda. É possível cadastrar endereço avulso; Enter no CEP consulta/preenche sem salvar o formulário. Os botões de consulta continuam disponíveis.
- Remover um dado principal seleciona o primeiro canal/vínculo restante aplicável. No servidor, a ausência de seleção explícita também usa o primeiro disponível. Não é obrigatório cadastrar empresa ou telefone.
- A listagem apresenta empresa, e-mail e telefone principais; os demais e-mails ficam disponíveis no cadastro e na indicação da listagem. Cargo pode ser habilitado em Colunas.
- E-mails são normalizados e exclusivos dentro da empresa. Telefones repetidos com formatações diferentes são recusados. Mais de um principal de cada tipo também é recusado.
- Mantida a criação/edição pelo remetente: procura primeiro o e-mail existente para abrir o contato correto. A administração controla a exibição por caixas; basta acesso a uma caixa autorizada para visualizar o contato completo.

Empresas reutilizadas têm um cadastro comum dentro da empresa do APMail: alterar razão social/nome fantasia/CNPJ atualiza essa mesma empresa nos seus vínculos.

## Cadastro de empresas

Menu **Empresas**, rota `/companies`, com listagem paginada no servidor, busca por CNPJ/razão social/nome fantasia, ordenação, colunas e criação/edição. Empresas deste cadastro são organizações vinculáveis a contatos, distintas das tenâncias geridas pela plataforma.

O formulário permite cadastro manual com ou sem CNPJ, vários endereços, busca de empresa existente e preenchimento por CNPJ/CEP com Enter. Também pode ser aberto dentro do contato para criar uma empresa e selecioná-la sem sair da edição. Excluir empresa ainda vinculada a contatos é bloqueado; seus vínculos precisam ser removidos antes.

Contatos e empresas novos ficam disponíveis em todas as caixas da tenância. Proprietário/admin e supervisores com capacidade `contacts_visibility` podem restringir a caixas específicas. Membros não podem alterar essa configuração. A restrição de uma empresa controla o catálogo, sua ficha e sua categoria na busca; preserva-se o acordo de contato completo: dados de empresa já associados a um contato compartilhado continuam compondo esse contato. Para restringir esse compartilhamento, configure também a visibilidade do contato.

Proprietários/admins gerenciam esses cadastros mesmo antes de conectar a primeira caixa. Membros sem caixa autorizada continuam sem resultados operacionais.

Empresas existentes são editadas na sua própria ficha. Salvar um contato com referência a empresa não altera silenciosamente seu cadastro comum.

## Busca superior

O campo do cabeçalho aceita texto e o atalho Ctrl/Cmd K. Consulta após 300 ms e pelo menos dois caracteres. Setas e Enter navegam pelos resultados; Escape fecha. Selecionar um resultado abre seu destino sem recarregar a página, incluindo o editor do contato encontrado.

Categorias: Contatos, Empresas, E-mails, Caixas de entrada, Configurações, Filas, Etiquetas, Pastas, Envios e rascunhos e Chat. Cada grupo exibe até cinco resultados; quando há mais, orienta refinar o termo. Busca vazia, carregamento, ausência de resultados e falha com nova tentativa têm apresentação própria.

Contatos são encontrados por nome, cargo, observações, canais, empresas e endereços. Telefone/CEP/CNPJ numéricos aceitam pesquisa com ou sem formatação. E-mails usam busca textual existente e assunto/remetente parcial. Caixas, pastas, etiquetas e atalhos usam seus nomes/contextos. Chat busca nome/conteúdo de conversas das quais o usuário participa; Envios respeita a visibilidade operacional e a privacidade dos rascunhos.

O endpoint `GET /api/search?q=...` consulta exclusivamente a empresa atual. Permissões são aplicadas antes do limite e da montagem dos resultados, inclusive pastas descendentes. Um assunto de mensagem restrita não pode identificar um resultado autorizado da mesma conversa. Contatos/empresas sem exibição permitida, caixas alheias, etiquetas de terceiros, rascunhos de terceiros e chats sem participação ativa não aparecem. Superadmin continua sem acesso operacional. Não são retornados corpos HTML, anexos nem credenciais.

## Migração e publicação

A migration aditiva `0020_contacts_primary_channels.sql` cria cargo/telefones, principais de e-mail/empresa e o vínculo explícito entre contato e empresa/endereço. Preserva cadastros antigos, converte o telefone anterior e escolhe principais legados de forma determinística. Atualiza a projeção de bytes lógicos das colunas novas; o preenchimento não é barrado por uma cota já cheia. As verificações de crescimento voltam a valer ao término da transação.

A nova `0021_company_directory.sql` amplia a tabela existente `contact_companies`, adicionando endereços, datas e visibilidade, e cria `contact_company_mailboxes` com chaves por tenância. Aproveita os registros já existentes no APMail e preserva restrições das empresas associadas exclusivamente a contatos restritos. Endereços existentes são preservados e disponibilizados na ficha da empresa. O catálogo/projeção de armazenamento inclui os novos campos e vínculos; preenchimento ensaiado com cota cheia.

Aplicar migrations e publicar API/web em conjunto pelo fluxo habitual. Não executar reset/seed. Nenhum segredo ou configuração adicional é necessário. Commit e deploy ficam com o usuário; esta entrega não modifica a produção.

## Validação

- Tipos, lint e build do workspace.
- 71 testes unitários; 13 integrações de contatos/busca/empresas e 22 regressões de evolução com PostgreSQL/Redis de QA.
- Três testes de migrations, incluindo atualização de contatos existentes com cota cheia e conferência de bytes/canais preservados.
- Navegador com dados sintéticos: formulários de contato e empresa em 1440/900/390/320 px, claro/escuro (16 cenários), axe WCAG A/AA, ausência de overflow e erros JavaScript. Seleção de empresa, múltiplos canais/principais, busca e consultas por Enter, cadastro de endereço avulso e formulário aninhado para nova empresa.

As validações de interface usam respostas controladas; integrações de persistência/permissões usam o banco e o Redis exclusivos de QA. Timeouts padrão de alguns testes preexistentes foram excedidos durante execução concorrente; a repetição com 20 s e menor concorrência passou. Não houve teste manual com leitor de tela nem envio de mensagens reais.
