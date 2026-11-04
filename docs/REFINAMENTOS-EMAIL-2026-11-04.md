# Refinamentos do e-mail — 04/11/2026

- O assunto da conversa aberta permite selecionar/copiar texto normalmente; arrastar mensagens continua disponível na lista.
- O compositor usa cabeçalho preenchido na cor primária, sem margem externa, com cursor normal. Mantém posição, teclado, minimizar/maximizar e tema claro/escuro.
- Sugestões de destinatários vêm somente dos envios atribuídos ao usuário nas caixas/pastas que ele pode ler, além dos contatos globais e pessoais acessíveis. E-mails recebidos, envios de terceiros e diretório de usuários/caixas não são acrescentados ao autocomplete.
- Domínios permitem arraste direto e Alt+setas, com ordem pessoal salva no mesmo registro de preferências. Arraste de caixas/pastas não interfere no arraste dos grupos.
- O seletor de destino tem busca por caminho completo, navegação por pastas/subpastas, voltar, raiz e confirmação explícita. É reutilizado para mensagens, lote e mudança de hierarquia de pasta.
- Mensagens podem ser movidas para outra caixa da mesma empresa pelo seletor ou arraste, respeitando leitura/organização/movimentação na origem e no destino. Pastas continuam sendo movidas somente dentro da sua caixa.
- “Clonar e-mail”, em Mais ações, cria rascunho independente com assunto, texto/HTML e Para/Cc/Cco originais, sem anexos ou referências a arquivos inline.

## Movimentação entre caixas

A API registra a ação e IDs estáveis de destino no JSON existente de `mail_actions`. O worker bloqueia as duas caixas em ordem consistente, copia conteúdo e arquivos, verifica cota e registra novas verificações de segurança dos arquivos. A origem só é removida depois da confirmação do destino.

Para IMAP, o destino é identificado por um marcador único no MIME em cada tentativa. A validade dos UIDs e a identidade da mensagem de origem são conferidas antes de ler/excluir. Falhas preservam os e-mails ainda não movidos e notificam o solicitante; em falhas parciais, uma cópia já confirmada pode permanecer no destino.

Sem novas dependências ou alterações de esquema. Nenhum deploy ou envio de e-mail real foi executado.

## Verificação

Lint, typecheck e build. Testes direcionados de sugestões/permissões, clone, domínios, seletor e consumidores; integração de transferência com PostgreSQL/Redis reais, preservação de anexos, repetição após falha e proteção de UIDVALIDITY. Transporte IMAP simulado, sem movimentar mensagens reais de clientes.

Navegador em 1440×900, 768×1024 e 390×844: assunto selecionável, compositor azul sem margem/cursor de arraste, clone salvo independente, sugestão de enviado, ordenação de domínio persistida, pesquisa e navegação de subpastas, mudança entre caixas pelo menu e arraste, sem erros de execução nos fluxos conferidos. O layout da lista em telas menores mantém as mensagens acessíveis quando a barra de seleção está expandida.
