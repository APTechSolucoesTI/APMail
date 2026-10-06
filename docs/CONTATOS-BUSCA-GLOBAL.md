# Contatos e busca global — 06/10/2026

Implementação local baseada na inspeção autenticada, somente de leitura, de Contatos e da busca superior do APTicket. Foram aproveitados a organização por canais, a seleção de principais por estrela e os resultados agrupados por categoria. Dados de clientes e permissões específicas do APTicket não foram copiados para o APMail.

## Cadastro e edição

- Nome, cargo e observações; vários e-mails e telefones, com identificação e seleção do principal por estrela.
- Cada e-mail aceita vários vínculos de empresa/endereço. Um endereço também pode existir sem empresa. A empresa principal é uma escolha única do contato, independente do e-mail principal.
- Empresas/endereço aparecem em seções expansíveis. É possível cadastrar manualmente, consultar CNPJ/CEP ou selecionar uma empresa já vinculada a um contato que o usuário pode visualizar. Selecionar uma empresa existente conserva sua identidade, inclusive quando não possui CNPJ.
- Remover um dado principal seleciona o primeiro canal/vínculo restante aplicável. No servidor, a ausência de seleção explícita também usa o primeiro disponível. Não é obrigatório cadastrar empresa ou telefone.
- A listagem apresenta empresa, e-mail e telefone principais; os demais e-mails ficam disponíveis no cadastro e na indicação da listagem. Cargo pode ser habilitado em Colunas.
- E-mails são normalizados e exclusivos dentro da empresa. Telefones repetidos com formatações diferentes são recusados. Mais de um principal de cada tipo também é recusado.
- Mantida a criação/edição pelo remetente e a vinculação a contato existente. A administração controla a exibição por caixas; basta acesso a uma caixa autorizada para visualizar o contato completo.

Empresas reutilizadas têm um cadastro comum dentro da empresa do APMail: alterar razão social/nome fantasia/CNPJ atualiza essa mesma empresa nos seus vínculos.

## Busca superior

O campo do cabeçalho aceita texto e o atalho Ctrl/Cmd K. Consulta após 300 ms e pelo menos dois caracteres. Setas e Enter navegam pelos resultados; Escape fecha. Selecionar um resultado abre seu destino sem recarregar a página, incluindo o editor do contato encontrado.

Categorias: Contatos, E-mails, Caixas de entrada, Configurações, Filas, Etiquetas, Pastas, Envios e rascunhos e Chat. Cada grupo exibe até cinco resultados; quando há mais, orienta refinar o termo. Busca vazia, carregamento, ausência de resultados e falha com nova tentativa têm apresentação própria.

Contatos são encontrados por nome, cargo, observações, canais, empresas e endereços. Telefone/CEP/CNPJ numéricos aceitam pesquisa com ou sem formatação. E-mails usam busca textual existente e assunto/remetente parcial. Caixas, pastas, etiquetas e atalhos usam seus nomes/contextos. Chat busca nome/conteúdo de conversas das quais o usuário participa; Envios respeita a visibilidade operacional e a privacidade dos rascunhos.

O endpoint `GET /api/search?q=...` consulta exclusivamente a empresa atual. Permissões são aplicadas antes do limite e da montagem dos resultados, inclusive pastas descendentes. Um assunto de mensagem restrita não pode identificar um resultado autorizado da mesma conversa. Contatos/empresas sem exibição permitida, caixas alheias, etiquetas de terceiros, rascunhos de terceiros e chats sem participação ativa não aparecem. Superadmin continua sem acesso operacional. Não são retornados corpos HTML, anexos nem credenciais.

## Migração e publicação

A migration aditiva `0020_contacts_primary_channels.sql` cria cargo/telefones, principais de e-mail/empresa e o vínculo explícito entre contato e empresa/endereço. Preserva cadastros antigos, converte o telefone anterior e escolhe principais legados de forma determinística. Atualiza a projeção de bytes lógicos das colunas novas; o preenchimento não é barrado por uma cota já cheia. As verificações de crescimento voltam a valer ao término da transação.

Aplicar migrations e publicar API/web em conjunto pelo fluxo habitual. Não executar reset/seed. Nenhum segredo ou configuração adicional é necessário. Commit e deploy ficam com o usuário; esta entrega não modifica a produção.

## Validação

- Tipos, lint e build do workspace.
- 70 testes unitários; nove integrações novas e 22 regressões de evolução com PostgreSQL/Redis de QA.
- Três testes de migrations, incluindo atualização de contatos existentes com cota cheia e conferência de bytes/canais preservados.
- Navegador com dados sintéticos: 1440/900/390/320 px, claro/escuro, axe WCAG A/AA, ausência de overflow e erros JavaScript. Troca/remoção dos principais, duplicação de e-mail, reutilização de empresa, consulta de CEP e navegação por teclado sem recarga.

As validações de interface usam respostas controladas; integrações de persistência/permissões usam o banco e o Redis exclusivos de QA. Timeouts padrão de alguns testes preexistentes foram excedidos durante execução concorrente; a repetição com 20 s e menor concorrência passou. Não houve teste manual com leitor de tela nem envio de mensagens reais.
