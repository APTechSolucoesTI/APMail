# Contatos, empresas, etiquetas e envio — 07/10/2026

Implementado no workspace conforme [plano aprovado](PLANO-CONTATOS-ETIQUETAS-ENVIO.md). Commit e deploy pelo usuário; nenhuma importação de contatos ou alteração de produção nesta entrega.

## Agenda e formulário

Contatos e empresas são compartilhados com todos os membros ativos da mesma tenância, inclusive membros sem acesso a caixas. Empresas do diretório representam organizações dos contatos, distintas das tenâncias clientes da plataforma. Outra tenância e superadmin não acessam a agenda operacional.

- Empresas opcionais no primeiro campo, vinculadas diretamente ao contato. Várias empresas, uma principal, chips com estrela e informações por empresa sob demanda.
- Nome obrigatório, cargo, Meu apelido, e-mails e telefones com título opcional. Apelido é exclusivo do usuário atual; os demais dados são compartilhados.
- Pelo menos um e-mail; cada conjunto não vazio tem exatamente um principal. Remover o principal promove o primeiro restante. E-mails são normalizados e exclusivos por contato dentro da tenância; telefones repetidos com outra formatação são recusados.
- Endereços ficam somente nas empresas. Não existem endereço avulso no contato nem vínculo de empresa/endereço por e-mail.
- Observações e histórico sob demanda. Cabeçalho com Enviar novo e-mail; contato novo precisa ser salvo. Alterações pendentes oferecem salvar e continuar, usar os dados salvos ou cancelar.
- Criar/editar pelo remetente procura primeiro o e-mail existente. Excluir exige proprietário/admin ou supervisor autorizado por `contacts_manage`; membro comum não recebe essa capacidade.

Empresa selecionada mantém sua identidade; salvar contato não altera o cadastro da empresa. Listagem independente `/companies`, pesquisa por CNPJ/razão social/nome fantasia, cadastro manual com ou sem CNPJ, vários endereços e consultas CNPJ/CEP com Enter ou botão. Empresa vinculada não pode ser excluída antes de remover os vínculos.

O ícone Info consulta a ficha salva e mostra razão social, nome fantasia, CNPJ e todos os endereços. Abre por mouse, foco de teclado ou toque, admite rolagem e fecha com Escape. Os portais dos seletores ficam dentro do diálogo atual, preservando o bloqueio do fundo e a roda do mouse. Temas claro/escuro e layout de celular seguem os componentes existentes.

## Apelido, busca e histórico

`contact_user_nicknames` guarda um apelido por contato/usuário. Sessão determina o proprietário; a API não aceita editar o apelido de terceiros. Admin vê apenas o próprio. Campo vazio remove somente seu registro. Apelido não muda nome cadastral ou cabeçalho enviado e não aparece na auditoria compartilhada. Contabilização usa bytes por tenância sem revelar o conteúdo ao superadmin.

Listagem, busca global e sugestões de destinatários pesquisam nome, empresa e apelido do solicitante, sem distinção de acentos/caixa e com espaços normalizados. Permanecem pesquisas por e-mail, telefone e CNPJ. Sugestões apresentam nome, apelido pessoal, empresa principal e endereços disponíveis; seleção adiciona somente o e-mail escolhido. Entrada manual continua disponível.

Busca superior preserva categorias Contatos, Empresas, E-mails, Caixas, Configurações, Filas, Etiquetas, Pastas, Envios/rascunhos e Chat, atalho Ctrl/Cmd K e navegação SPA. API limita grupos e filtra cada categoria por suas permissões. Caches com apelidos incluem usuário e tenância; atualizações compartilhadas notificam sem conteúdo privado, e mudança independente de apelido notifica somente seu usuário.

Histórico resolve os e-mails salvos do contato, permitindo todos ou um específico, com paginação e datas/horários. Filtra caixas e pastas permitidas no servidor antes de obter resultados e total. Agenda compartilhada não concede acesso a assuntos, contagens, participantes ou anexos restritos.

## Enviar pelo contato

Enviar novo e-mail abre uma confirmação de destinatário e caixa remetente autorizada. Principal é pré-selecionado; mais de uma caixa exige escolha explícita. Nenhuma caixa com envio impede abrir o compositor e explica o motivo. Cancelar não cria rascunho.

O compositor abre preenchido; Para e De podem ser alterados em mensagem nova. Troca de De serializa salvamento, preserva assunto/corpo/destinatários/anexos, substitui assinatura automática e verifica permissões e cotas. Upload passa a utilizar a caixa atual. Respostas/encaminhamentos mantêm o vínculo com a conversa original.

API transfere uploads, referências e propriedade contábil em transação. Chave física do arquivo permanece imutável, com acesso determinado pela propriedade atual no banco. Não há cópia dupla nem perda do arquivo. Falha de quota/permissão mantém caixa anterior e rascunho. Upload também referenciado por outro rascunho bloqueia transferência, evitando alterar o arquivo daquele rascunho.

## Etiquetas

Catálogo único com escopos Pessoal e Global da empresa, na mesma listagem/menu/seletor. Nome e cor aparecem com indicação de escopo. Cor livre `#RRGGBB`, seletor de matiz e gradiente, sliders acessíveis, entrada hexadecimal e prévia com contraste calculado. Código CSS arbitrário é recusado.

| Operação                 | Pessoal                                 | Global                         |
| ------------------------ | --------------------------------------- | ------------------------------ |
| Criar/editar/excluir     | Proprietário da etiqueta                | Proprietário/admin da tenância |
| Visualizar cadastro      | Somente o proprietário                  | Membros da tenância            |
| Aplicar/remover          | Proprietário com acesso à conversa      | Usuário com acesso à conversa  |
| Ver aplicações/contagens | Somente próprias e conversas acessíveis | Somente conversas acessíveis   |

Admin pode criar pessoal ou global, inicialmente pessoal. Supervisor não recebe gestão de globais automaticamente. Escopo não muda por edição. Nomes únicos após normalizar espaços e caixa no conjunto pessoal do usuário ou global da tenância; nomes iguais em escopos diferentes são permitidos e identificados.

Aplicação global é um único vínculo compartilhado e auditado. API usa adicionar/remover explícitos, idempotentes e transacionais; salvar pessoais não remove globais nem etiquetas de terceiros. Ações em lote seguem o mesmo contrato. Contagem respeita caixa e pasta. Excluir pede confirmação e remove suas aplicações. Regras pessoais podem aplicar etiquetas próprias ou globais; worker ignora referência excluída e registra aplicação global por regra.

## Persistência e publicação

Migration `0022_directory_labels.sql` preserva IDs, cores anteriores convertidas para hexadecimal, proprietários, regras e aplicações. Nomes físicos `personal_labels` e `thread_personal_labels` permanecem, agora com escopo explícito. Relação contato–empresa usa `contact_company_links`, sem associação por e-mail.

Endereços associados são consolidados no cadastro da empresa, comparando campos normalizados. Dados avulsos, relações antigas e restrições anteriores são arquivados em `directory_legacy`. Tabelas obsoletas ficam vazias e não aceitam novas escritas. Apelidos começam vazios; agendas existentes tornam-se compartilhadas. Capacidade de supervisor `contacts_visibility` passa a `contacts_manage`, preservando exclusão autorizada.

Catálogo/projeções de consumo contam dados ativos e legado retido; backfill não falha com quota preexistente cheia. Depois da migração, crescimento segue sujeito a quota. Colisão de nomes normalizados interrompe a migração sem fundir ou excluir dados. Publicar migration/API/web/worker juntos; instruções e recuperação em [DEPLOY.md](DEPLOY.md). Evidências em [PROGRESSO.md](PROGRESSO.md).
