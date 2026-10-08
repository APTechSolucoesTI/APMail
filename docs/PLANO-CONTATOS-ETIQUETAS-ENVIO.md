# Plano de ação — contatos, empresas, etiquetas e envio

> Plano histórico. A entrega [Contatos Outlook, listagens e etiquetas](PLANO-CONTATOS-OUTLOOK-LISTAGENS-ETIQUETAS.md) substitui empresas vinculadas, visibilidade da agenda e etiquetas/regras. Publicação atual usa migration 0023; consulte o plano vigente.

Data: 07/10/2026. Status: **fases 1–6 implementadas no workspace; publicação pelo usuário**.

Revisão posterior em planejamento: [contatos por usuário, importação Outlook, listagens e etiquetas por caixa](PLANO-CONTATOS-OUTLOOK-LISTAGENS-ETIQUETAS.md). Quando implementada, substituirá as regras deste documento sobre empresas como entidades, agenda sempre global e etiquetas globais em regras pessoais. O comportamento atual continua sendo o desta entrega.

Este documento registra as regras aprovadas e implementadas. Elas substituem as regras anteriores de vínculos por e-mail, endereços de contato e visibilidade por caixa. O comportamento entregue está em [CONTATOS-BUSCA-GLOBAL.md](CONTATOS-BUSCA-GLOBAL.md). Sem commit, deploy, importação de contatos ou alteração de produção pelo assistente.

## 1. Decisões confirmadas

| Área                   | Regra a implementar                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empresas do contato    | Vínculo direto ao contato, opcional, com várias empresas e uma principal.                                                                                                                          |
| Endereços              | Exclusivamente no cadastro de empresas. Contato não terá endereço próprio, avulso nem vinculado a um e-mail.                                                                                       |
| E-mails                | Vários por contato, com um principal, independentes das empresas. E-mail permanece exclusivo por contato dentro da tenância.                                                                       |
| Telefones              | Vários, com um principal e título opcional para identificar cada número.                                                                                                                           |
| Apelido                | Pessoal: cada usuário define o seu apelido para o mesmo contato, sem compartilhar com os demais.                                                                                                   |
| Disponibilidade        | **Contatos e empresas disponíveis para todos os usuários da mesma tenância**, em todas as caixas. Remover os controles de visibilidade de ambos os formulários. Confirmação explícita do usuário.  |
| Informações da empresa | Ícone `Info` por empresa selecionada, com balão sob demanda contendo todos os dados cadastrais.                                                                                                    |
| Novo e-mail            | Escolher o **e-mail destinatário do contato** e a **caixa remetente do APMail** antes de abrir a mensagem. Confirmação explícita do usuário.                                                       |
| Busca de contato       | Nome, empresa e apelido pessoal em listagem, envio, busca global e seleção para histórico. Preservar busca por e-mail, telefone e CNPJ.                                                            |
| Etiqueta pessoal       | Cadastro e aplicação privados ao seu proprietário, inclusive quando ele é admin.                                                                                                                   |
| Etiqueta global        | Criada/gerida por proprietário ou admin da tenância; disponível a todos os seus usuários. Aplicação à conversa **compartilhada entre quem tem acesso à conversa**, conforme confirmação explícita. |
| Cor da etiqueta        | Qualquer cor RGB escolhida por seletor de matiz e gradiente, com alternativa de digitação do código da cor.                                                                                        |
| Menu                   | Ícone em Contatos e nos itens de Configurações. Etiquetas exibem nome, cor e distinção pessoal/global na mesma navegação.                                                                          |
| Rolagem                | Roda do mouse, trackpad, toque e teclado devem funcionar nos seletores/balões, inclusive dentro de modais.                                                                                         |

As empresas desta funcionalidade são organizações vinculadas a contatos. Elas não se confundem com a tenância/empresa cliente da plataforma.

## 2. Contato e cadastro de empresas

### 2.1 Formulário de contato

Preservar a composição do print já usada no formulário: empresas no topo, chips e principais por estrela, campos compactos, corpo rolável e rodapé fixo.

1. Cabeçalho: Novo/Editar contato e ação **Enviar novo e-mail**.
2. Empresas opcionais: busca por CNPJ, razão social ou nome fantasia; seleção múltipla; estrela da principal; remoção do vínculo; `Info` em cada chip.
3. Nome obrigatório, cargo opcional e **Meu apelido**, com ajuda “Visível apenas para você”.
4. E-mails obrigatórios: pelo menos um, com seleção do principal. Sem empresas/endereço por e-mail e sem campos de identificação.
5. Telefones opcionais: número, **Título** opcional (ex.: Comercial, Celular, Financeiro), seleção do principal e remoção. O título identifica apenas aquele telefone.
6. Observações compartilhadas sob demanda e ações Cancelar/Salvar contato no rodapé.

Empresa e telefone são opcionais. Se houver itens de um tipo, deve existir exatamente um principal; e-mail sempre tem um principal. O primeiro item é principal inicialmente. Remover o principal promove o primeiro restante. Rejeitar múltiplos principais e duplicidades no servidor; a interface também deve orientar a correção.

Apelido não substitui o nome cadastral, não altera o nome enviado no cabeçalho do e-mail e não precisa ser único. Sugestões/listagem mostram nome e apelido do usuário atual, preservando o nome original para desambiguação. Campo vazio remove somente o apelido desse usuário.

Em contato novo ainda não salvo, a ação de envio fica desabilitada com orientação para salvar o contato. Em contato existente com alterações pendentes, solicitar Salvar e continuar, Continuar com dados salvos ou Cancelar; nunca descartar alterações silenciosamente nem usar destinatário ainda não persistido.

### 2.2 Empresas e balão de informações

Manter cadastro independente `/companies`, empresas opcionais no contato, consulta CNPJ/CEP com Enter e botão, preenchimento manual e vários endereços. Endereços ficam exclusivamente na ficha da empresa; selecionar uma empresa não copia seus dados para o contato. Editar contato não atualiza silenciosamente a empresa.

O balão apresenta razão social, nome fantasia, CNPJ, todos os endereços e demais campos cadastrais efetivamente disponíveis. Dados ausentes recebem apresentação clara. Não mostrar credenciais, IDs internos ou informações de outras tenâncias. Usar o cadastro salvo como fonte, sem consultar serviços externos ao passar o mouse.

- Mouse: abrir no hover e manter aberto ao mover o ponteiro para o conteúdo.
- Teclado: botão com `aria-label="Informações de [empresa]"`, foco visível e abertura por foco/Enter/Espaço; Escape fecha e devolve o foco quando aplicável.
- Celular: toque abre/fecha; conteúdo se adapta à largura e tem altura limitada com rolagem.
- Conteúdo extenso: usar painel informativo acessível, com foco/rolagem apropriados; um tooltip breve não basta para vários endereços.

Remover os seletores de visibilidade tanto de Contatos quanto de Empresas. Cadastros e empresas vinculadas ficam disponíveis aos membros ativos da tenância, inclusive usuários sem caixa conectada. Consultas de mensagens continuam exigindo acesso à caixa e à pasta. Excluir uma empresa ainda vinculada permanece bloqueado; remover um vínculo não exclui o cadastro da empresa.

### 2.3 Apelido pessoal e permissões

O servidor identifica o dono do apelido pela sessão autenticada. Não aceitar `user_id` fornecido pelo cliente para ler ou alterar apelidos. Um admin da tenância pode editar o contato compartilhado, mas visualiza/edita apenas o próprio apelido.

Não incluir apelidos em eventos compartilhados, auditoria de campos compartilhados, exportações de contatos da empresa ou respostas para outros usuários. Caches de detalhe/listagem/sugestões devem incluir usuário e tenância. Troca de sessão/tenância deve invalidar esses dados. O apelido pessoal entra na medição de metadados da tenância, sem revelar seu conteúdo nos relatórios administrativos de consumo.

Preservar as permissões atuais para criar/editar contatos e empresas. Remover o uso de `contacts_visibility` para controlar disponibilidade; separar sua utilização atual na exclusão em uma autorização explícita de gerenciamento, mantendo os privilégios de exclusão existentes de admins/proprietários e supervisores autorizados. Tornar a agenda compartilhada não concede exclusão a membros comuns. Superadmin continua sem acesso operacional aos contatos ou às mensagens.

## 3. Pesquisa, histórico e novo e-mail

### 3.1 Busca consistente

Reutilizar a mesma regra no servidor para pesquisar contatos por nome, razão social/nome fantasia das empresas vinculadas e apelido **do solicitante**. Comparação sem distinção de maiúsculas/minúsculas ou acentos e com espaços normalizados. Manter pesquisa por e-mail, telefone e CNPJ com/sem formatação. A consulta da empresa continua aceitando CNPJ, razão social e nome fantasia no mesmo campo.

Aplicar em:

- Contatos e sua listagem paginada no servidor.
- Busca global, categoria Contato, preservando categorias e navegação SPA.
- Seleção de contato antes de compor e sugestões em Para/Cc/Cco.
- Seleção de contato para consultar histórico de mensagens.

Sugestão mostra nome, apelido pessoal quando houver, empresa principal e e-mails disponíveis; empresas adicionais também participam da busca. Selecionar contato com vários e-mails abre a escolha do destinatário, sem enviar automaticamente a todos. Preservar entrada manual de destinatários não cadastrados.

Pesquisa de histórico resolve o contato pelos campos acima e consulta seus e-mails salvos, com opção de todos ou um e-mail específico. Retornar somente mensagens/conversas das caixas e pastas autorizadas ao solicitante. A agenda compartilhada não permite descobrir assuntos, participantes, contagens ou anexos de caixas restritas.

Usar debounce de 300–500 ms, ignorar/cancelar respostas obsoletas, paginação/total confiáveis, estados vazio/erro/carregamento e retorno à primeira página ao mudar filtros. Apelido usado como critério não pode resultar em pesquisa pelos apelidos de terceiros.

### 3.2 Fluxo de envio

```text
Contato encontrado / Enviar novo e-mail
  → escolher e-mail do contato (destinatário)
  → escolher caixa autorizada do APMail (remetente)
  → confirmar as escolhas
  → abrir compositor preenchido, sem recarregar a página
  → permitir editar Para e De no cabeçalho
```

- Um destinatário: pré-selecionar. Vários: apresentar lista com o principal destacado e pré-selecionado, confirmando a escolha.
- Uma caixa com permissão de envio: pré-selecionar. Várias: mostrar escolha explícita e identificada por nome/e-mail; não listar caixas alheias ou apenas de leitura.
- Nenhuma caixa remetente permitida: explicar a falta de permissão e bloquear abertura para envio. O contato continua acessível.
- Cancelar a escolha não cria rascunho nem altera o contato.
- Alterar destinatário depois não modifica o cadastro do contato.
- Alterar remetente em **mensagem nova** preserva destinatários, assunto e corpo; atualiza assinatura para a caixa selecionada e revalida permissão de envio, anexos, imagens embutidas e cotas.
- Revalidar permissões no servidor no salvamento, upload, agendamento e envio. Revogação de acesso durante a composição não pode ser contornada pelo estado antigo da interface.

O compositor atual já troca o campo De para mensagens novas, mas o upload usa a propriedade inicial `mailboxId`. Corrigir para a caixa atualmente selecionada e tratar os anexos existentes: transferência autorizada e transacional de propriedade/medição para a nova caixa, respeitando cotas e integridade das referências. Se a mudança não puder ser concluída, manter a caixa anterior, os anexos e o rascunho, apresentando o motivo; nunca perder arquivos ou atribuí-los à caixa errada.

Mudança de remetente e salvamento automático devem ser serializados; aguardar uploads/salvamento em andamento antes da troca. Assinatura automática deve ser substituída sem duplicar nem apagar texto digitado. Rascunho salvo precisa reabrir com caixa, assinatura e anexos corretos. Respostas/encaminhamentos mantêm o vínculo/permissão da conversa de origem; a nova seleção antes de compor se aplica ao fluxo de **novo e-mail**.

## 4. Etiquetas pessoais e globais

### 4.1 Cadastro, aplicação e privacidade

| Operação                    | Pessoal                              | Global da tenância                        |
| --------------------------- | ------------------------------------ | ----------------------------------------- |
| Criar                       | Qualquer usuário operacional         | Proprietário/admin                        |
| Ver cadastro                | Apenas o dono                        | Todos os usuários da tenância             |
| Editar/excluir              | Apenas o dono                        | Proprietário/admin                        |
| Aplicar/remover em conversa | Dono, com acesso à conversa          | Usuário com acesso à conversa             |
| Ver aplicação               | Apenas o dono, com acesso à conversa | Usuários com acesso à conversa            |
| Contagem/lista de conversas | Somente conteúdo permitido ao dono   | Somente conteúdo permitido ao solicitante |

Admin/proprietário pode escolher **Pessoal** ou **Global da empresa** na criação; padrão Pessoal. Membro e supervisor comum criam somente pessoais. Não conceder gestão global automaticamente ao supervisor. Etiquetas pessoais existentes permanecem pessoais. Não permitir transformar uma etiqueta pessoal em global pelo simples envio de um payload de edição.

Na mesma listagem, seletor e menu, mostrar **Pessoal** ou **Global** com texto/indicador acessível. Manter nome e cor escolhida. Se houver nomes iguais nos dois escopos, diferenciá-los claramente. Nome é único dentro do conjunto pessoal do usuário ou do conjunto global da tenância; validar espaços e maiúsculas/minúsculas de forma consistente no banco e na API. Não fundir etiquetas pessoais de usuários diferentes durante a migração.

Aplicações globais usam um vínculo compartilhado por conversa/etiqueta, sem criar cópias por usuário. Registrar quem aplicou/removeu. Editar nome/cor global reflete para todos. Excluir global exige confirmação indicando que será removida das conversas; excluir pessoal afeta apenas o proprietário. Outros usuários, inclusive admins, não podem descobrir as etiquetas pessoais de terceiros.

Para globais, usar operações explícitas de adicionar/remover, com idempotência e transação, evitando substituir toda a seleção compartilhada a partir de um formulário desatualizado. Alterar as etiquetas pessoais não apaga globais; nenhum caminho apaga pessoais de outro usuário. Tratar também operações em lote e concorrência entre dois usuários.

Manter as ações atuais de regras: regras pessoais podem selecionar etiquetas próprias ou globais disponíveis; aplicação global por regra também é compartilhada e registra sua origem. Ajustar API, editor e worker juntos. Não acrescentar novos tipos de ação às regras de caixa nesta entrega.

### 4.2 Cor livre e menu

- Seletor de matiz e área de saturação/valor com gradiente para escolher tons claros/escuros; prévia imediata e código hexadecimal editável.
- Qualquer cor RGB, armazenada em formato hexadecimal canônico `#RRGGBB`. Validar no cliente/servidor; rejeitar CSS arbitrário, URLs e valores inválidos. A restrição é de formato, não de paleta.
- Alternativa acessível por campo hexadecimal/controles de teclado: selecionar cor não pode depender exclusivamente de arrastar um ponto no gradiente.
- Na prévia/badge, escolher texto claro ou escuro pelo contraste calculado. Na navegação, nome usa cor semântica legível e a cor personalizada aparece no marcador/ícone/badge, com contorno quando necessário para branco/preto e cores próximas ao fundo.
- Preservar a cor escolhida nos temas claro e escuro; cor de etiqueta é dado do usuário, não estado de erro/alerta. Indicadores de escopo e seleção não dependem apenas da cor.
- Menu mantém o nome visível, com valor completo acessível em nomes longos, cor e indicador de escopo; reservar espaço de contadores/setas para evitar o corte já corrigido anteriormente.
- Contadores de etiquetas globais respeitam **caixas e pastas acessíveis**, sem informar totais ocultos. Se o contador representar várias caixas, indicar o contexto; filtro aberto continua limitado à caixa selecionada.

## 5. Navegação e rolagem

Ícones Lucide sugeridos: Contatos `ContactRound`; Configurações `Settings`; Meu perfil `UserRound`; Preferências `SlidersHorizontal`; Assinaturas `Signature`; Etiquetas `Tags`; Regras `ListFilter`; Equipe `UsersRound`; Caixas de e-mail `Mail`; Empresa `Building2`; Auditoria `ClipboardList`. Reutilizar os ícones existentes quando equivalentes e manter dimensões/alinhamento consistentes.

Inspecionar cada seletor de empresas/e-mails/telefones e cada balão dentro dos modais. O `PopoverContent` atual usa portal fora do conteúdo do diálogo; existe uma hipótese de conflito com o bloqueio de rolagem do modal, a confirmar no navegador. A correção deve integrar o portal à área de rolagem autorizada do diálogo, preservar foco e camadas e continuar bloqueando o fundo. Evitar liberar indiscriminadamente a rolagem da página ou usar captura global da roda do mouse.

Testar listas longas, modais aninhados, movimentos sobre inputs/itens e limites superior/inferior. O conteúdo do balão deve rolar sem fechar, prender o foco ou deslocar indevidamente a página de fundo. Tab, setas e PageUp/PageDown devem continuar utilizáveis conforme o controle.

## 6. Modelo de dados e migração

Modelo proposto; nomes finais seguem as convenções do repositório:

| Entidade                 | Responsabilidade e integridade                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contacts`               | Dados compartilhados do contato; remover dependência da visibilidade por caixa.                                                                                                     |
| `contact_emails`         | E-mails independentes, principal por contato e unicidade normalizada por tenância.                                                                                                  |
| `contact_company_links`  | Relação direta tenância/contato/empresa; par único; um principal por contato. Chaves compostas impedem referências entre tenâncias.                                                 |
| Telefones do contato     | Reaproveitar `phones` existente com número, título (`label`) e principal; preservar números/títulos legados.                                                                        |
| `contact_user_nicknames` | Tenância/contato/usuário/apelido; registro único por usuário/contato; vínculo com usuário membro e contato da mesma tenância.                                                       |
| `contact_companies`      | Dados e endereços canônicos da empresa; remover dependência da visibilidade por caixa.                                                                                              |
| `personal_labels`        | Nome físico preservado; catálogo unificado com `scope=personal/tenant`, proprietário obrigatório apenas para pessoal, cor hexadecimal, criador e datas. IDs existentes preservados. |
| `thread_personal_labels` | Nome físico preservado; vínculo tenância/conversa/etiqueta e autor/data da aplicação; único por conversa/etiqueta. Privacidade derivada do escopo/proprietário do catálogo.         |

Aplicar autorização no servidor; não basta ocultar um controle. Contratos Zod devem separar campos compartilhados, apelido do solicitante, escopo e campos internos. Salvar contato e o apelido informado pelo próprio solicitante de forma transacional, preservando os apelidos dos demais. Permitir atualização independente do próprio apelido sem regravar os dados compartilhados.

### 6.1 Sequência de transição

1. Levantar registros existentes e contagens: vínculos por e-mail, empresas principais, endereços com/sem empresa, contatos/empresas restritos, etiquetas e suas aplicações/referências nas regras.
2. Criar estruturas novas de forma aditiva, com índices, chaves por tenância e validações de propriedade/escopo. Não fixar agora o número da migration; usar a próxima disponível na implementação.
3. Converter os vínculos atuais para contato–empresa, deduplicando por IDs e preservando a principal existente. Se faltar principal, usar ordem determinística. Empresa sem CNPJ mantém a identidade existente.
4. Consolidar endereços associados a empresas na ficha canônica dessas empresas, sem duplicar o que a migration `0021` já aproveitou. Tratar por vínculo e comparar todos os campos normalizados; não criar empresas fictícias para acomodar endereço avulso.
5. Endereços avulsos antigos: retirar do modelo/formulário ativo e preservar em arquivo/tabela de legado com tenância e contato de origem para conferência. Não apagar silenciosamente dados sem uma política de descarte. Preservar também metadados legados que não tenham equivalente no modelo novo.
6. Tornar contatos e empresas existentes disponíveis a toda a tenância, conforme autorização confirmada. Arquivar as antigas restrições para rastreabilidade; não alterar permissões de caixas/pastas/mensagens.
7. Criar estrutura de apelidos inicialmente vazia; não converter nome, observações ou dados compartilhados em apelido automaticamente.
8. Migrar etiquetas pessoais preservando IDs, proprietário, nomes, datas, aplicações e referências nas regras. Converter as oito cores antigas por mapa explícito revisado contra os tokens atuais; globais começam vazias. Relatar eventuais colisões de nomes após normalização antes de impor índice novo, sem excluir/fundir registros automaticamente.
9. Atualizar tipos Kysely/shared, catálogo/projeção/triggers de armazenamento e consultas. Dados ativos e arquivos/tabelas de legado entram na medição **uma vez cada**; armazenamento retido continua contabilizado como legado. Conferir medidas antes/depois e reconciliar por tenância, sem atribuir metadados compartilhados arbitrariamente a uma caixa.
10. Ensaiar em banco exclusivo de QA com dados antigos e cota cheia. Backfill autorizado não pode falhar por já estar no limite; operações novas continuam sujeitas às cotas. Não aumentar limites nem reiniciar/checkpoints de sincronização.

Desativar escrita/leitura dos vínculos e controles antigos somente após a conversão e a conferência. Documentar ordem de publicação de API/web/worker e migrations, janela de compatibilidade e recuperação por backup; downgrade de versão não pode restaurar automaticamente restrições/conceitos antigos. Não executar reset nem importar contatos externos.

## 7. Fases de implementação

| Fase                         | Entrega                                                                                                | Critério de conclusão                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1 — Persistência e migração  | Vínculos diretos, apelidos, agenda compartilhada, escopos/cores de etiquetas e medição.                | Dados/referências preservados; integridade por tenância; ensaio com legado e cota cheia.  |
| 2 — API e autorização        | CRUD atualizado, apelido pessoal, buscas comuns, etiquetas globais/pessoais e aplicação compartilhada. | Dois tenants/dois usuários sem vazamentos; permissões, concorrência e contagens corretas. |
| 3 — Contatos e empresas      | Formulário simplificado, títulos de telefone, Meu apelido, balões Info e retirada da visibilidade.     | Fluxo conforme print, principais e informação completa por mouse/teclado/toque.           |
| 4 — Busca, histórico e envio | Pesquisa unificada, escolha de destinatário/remetente, compositor e transferência de anexos.           | Rascunho íntegro após troca; envio/consumo na caixa correta; histórico autorizado.        |
| 5 — Etiquetas e worker       | Cor livre, escopos na mesma lista/menu, aplicação e regras pessoais compatíveis.                       | Global sincronizada, pessoal privada, contraste/teclado e automação preservados.          |
| 6 — Navegação e QA           | Ícones, correção de rolagem, regressões e documentação final.                                          | Checks e inspeções abaixo aprovados; instruções locais para publicação pelo usuário.      |

A persistência vem antes dos formulários para evitar recriar dados pelo modelo antigo. API, interface e worker de etiquetas devem ser entregues compatíveis entre si.

Executar na arquitetura existente do APMail: React/Vite/TanStack Router e Query, Fastify/Kysely/PostgreSQL e worker. Aplicar as diretrizes do AGENTS.md de tokens semânticos, componentes reutilizáveis, formulários validados, Lucide, acessibilidade e responsividade. As diferenças da stack oficial descrita no AGENTS.md ficam explicitadas aqui como decisão de preservar a arquitetura já adotada no projeto nesta evolução.

## 8. Critérios de aceite e validação

- Contato sem empresa e sem telefone, múltiplos de cada tipo, remoção/troca de principais, título de telefone preservado e unicidade de e-mail em criação/edição concorrente.
- Endereços aparecem somente nas empresas; contato referencia a empresa diretamente e não replica endereços nem os associa a e-mails. Legado existente preservado e contabilizado.
- Dois usuários dão apelidos diferentes ao mesmo contato; cada um pesquisa/recebe somente o próprio. Admin também não obtém apelido alheio por API, busca, exportação, cache ou evento.
- Contatos/empresas antes restritos passam à agenda inteira da tenância, inclusive sem caixa; outra tenância e superadmin operacional não acessam. Histórico permanece filtrado por caixa/pasta.
- Empresa sem CNPJ, busca por CNPJ/razão social/nome fantasia, consultas Enter e falha do serviço externo com cadastro manual preservado.
- Envio com um/vários destinatários e remetentes, nenhum remetente, cancelamento, alteração de destinatário e troca de De antes/depois de salvar e anexar. Inclui imagem embutida, assinatura, cota insuficiente, upload concorrente e revogação de acesso.
- Etiqueta pessoal invisível a terceiros; global criada/gerida somente por admin/proprietário; usuários aplicam/removem globais nas conversas acessíveis. Operações em lote, atualização simultânea, filtros e contagens sem vazamento de pastas/caixas.
- Regras pessoais mantêm aplicações antigas e podem aplicar globais autorizadas; exclusão de etiqueta não quebra o worker e referência indisponível recebe tratamento explícito.
- Cores fora da paleta, branco/preto, código inválido, contraste nos dois temas, escolha por teclado e nome/escopo/cor legíveis no menu.
- Mouse-wheel real, trackpad, toque e teclado nos seletores longos e Info; fundo do modal bloqueado; foco devolvido e página sem overflow.
- Desktop/tablet/mobile em 1440/900/390/320 px, claro/escuro, estados de loading/vazio/erro, axe e inspeção de teclado; respeitar redução de movimento.
- Lint, typecheck, testes pertinentes de shared/API/DB/worker e build. Regressões de consumo/quota, rascunhos, assinaturas, navegação e busca global.

Na implementação, atualizar [CONTATOS-BUSCA-GLOBAL.md](CONTATOS-BUSCA-GLOBAL.md), [SPEC-EVOLUCAO-APMAIL.md](SPEC-EVOLUCAO-APMAIL.md), [PROGRESSO.md](PROGRESSO.md) e instruções de migrations em [DEPLOY.md](DEPLOY.md) com o comportamento efetivamente entregue. Commit e deploy permanecem com o usuário.

## 9. Implementação entregue

Migration `0022_directory_labels.sql`: vínculos diretos, apelidos privados, catálogo de etiquetas com dois escopos, cores RGB e atribuição auditada. Relações antigas são arquivadas em `directory_legacy`, retiradas do uso ativo e protegidas contra novas escritas. Legado continua contabilizado como retido; backfill não é bloqueado por cota já cheia. Colisões de nomes de etiquetas após normalização interrompem a transação, sem fundir registros.

Na troca de remetente, uploads, referências e propriedade contábil mudam juntos em transação, com revalidação de permissões/cota. O arquivo mantém sua chave física imutável, sem duplicar bytes; download usa a propriedade atual no banco. Arquivo também utilizado por outro rascunho impede a transferência e apresenta orientação, preservando ambos. Respostas e encaminhamentos permanecem na caixa original.

As atualizações de diretório invalidam caches por evento sem dados privados. Alterar somente apelido emite evento apenas para seu proprietário; respostas e caches privados incluem usuário/tenância. Regras pessoais aceitam etiquetas próprias e globais; referências excluídas são ignoradas pelo worker.

Validação, evidências e comandos de publicação: [PROGRESSO.md](PROGRESSO.md) e [DEPLOY.md](DEPLOY.md). Revisão de navegador com dados sintéticos em 1440/900/390/320 px nos dois temas; serviços reais de banco, Redis, IMAP e SMTP exclusivos de QA nos testes de integração.
