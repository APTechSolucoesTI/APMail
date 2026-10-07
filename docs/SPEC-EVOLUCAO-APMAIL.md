# Evolução do APMail — especificação e plano de ação

Entrega de 07/10/2026: [contatos, empresas, etiquetas e envio](PLANO-CONTATOS-ETIQUETAS-ENVIO.md). **Implementada no workspace; publicação pelo usuário.** Agenda de contatos/empresas para toda a tenância, endereços somente nas empresas, vínculos diretos ao contato, apelidos pessoais, escolha de destinatário/remetente e etiquetas pessoais/globais com cor livre. As confirmações novas substituem as decisões antigas de visibilidade e vínculos. Migration `0022_directory_labels.sql`; comportamento atual em [CONTATOS-BUSCA-GLOBAL.md](CONTATOS-BUSCA-GLOBAL.md). Complementos abaixo registram o histórico das entregas anteriores.

Complemento local de 06/10/2026: [contatos, empresas e busca global](CONTATOS-BUSCA-GLOBAL.md). Formulário conforme o print, empresas opcionais no topo, múltiplos canais/vínculos, principais por estrela, consultas por Enter, cadastro independente de empresas e visibilidade por caixa. Stack existente e diretrizes visuais/acessíveis do AGENTS.md preservadas. Migrations `0020`/`0021`, publicação pelo usuário; as referências de produção abaixo descrevem entregas anteriores.

Atualização: 05/10/2026. Base original: entrega `fase-9`. Status: **implementado, validado e publicado**. Evolução inicial `d48682c`; dashboard por papel, teste de conexão antes de salvar e assinatura CID publicados no commit `6d0f711`, em [APMail](https://apmail.aptechinfo.com.br:75). Evidências em [PROGRESSO](PROGRESSO.md).

## 1. Decisões confirmadas

Novo trabalho de 05/10/2026: [Armazenamento e dashboard do superadmin — plano de ação](PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md). **Planejado, ainda não implementado**; o status de publicação acima refere-se às entregas anteriores. Sem planos comerciais ou cotas por cliente. O plano estabelece medição verificável por empresa/caixa, infraestrutura separada e visão geral da plataforma.

| Assunto                | Decisão do usuário                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contatos               | Por padrão, visíveis em todas as caixas da empresa. Ao ter acesso a pelo menos uma caixa autorizada, o usuário vê o contato completo, incluindo todos os seus e-mails e vínculos. |
| Histórico              | A janela de classificação vale somente para a importação inicial. Aceita 0–90 dias; 0 deixa todo o histórico sem fila. Mensagens novas seguem o fluxo normal.                     |
| Densidade              | Remover compacta/confortável e manter um padrão operacional único.                                                                                                                |
| Super admin            | Gestão exclusiva da plataforma, sem acesso operacional a caixas, mesmo com vínculos empresariais antigos. Armazenamento por empresa/caixa.                                        |
| Convites da empresa    | Administradores usam uma caixa conectada da própria empresa. Sem fallback para o SMTP global.                                                                                     |
| Convites da plataforma | Super admin usa o SMTP global.                                                                                                                                                    |

Referência visual: o print mencionado não está disponível como imagem nesta conversa. O editor foi implementado com os controles de fonte, tamanho, cores, alinhamento, listas, links, imagens, tabelas e edição solicitados por texto.

## 2. Diagnóstico inicial de 02/10/2026

| Área                  | Evidência no código                                                                                                            | Consequência                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Navegação             | `app-shell.tsx` usa `<a href>` em Envios e nas configurações; troca de empresa chama `location.reload()`                       | Há recargas completas em fluxos internos.                                                                                 |
| Menu                  | Sidebar desktop fixa, grupos sem recolhimento e pastas expostas diretamente ao abrir uma caixa                                 | Falta controle de expansão e ocultação da navegação.                                                                      |
| Spam                  | `sync-folders.ts` reconhece nomes `junk` e `spam` como `junk`; `folderLabel()` chama ambos de Spam                             | Duas pastas reais podem parecer um item duplicado. A caixa afetada precisa ser inspecionada para confirmar a causa exata. |
| Editor                | TipTap com negrito, itálico, sublinhado, listas, links, citação e limpar formatação                                            | Novos controles exigem extensões, representação HTML e revisão do sanitizador.                                            |
| Assinatura            | Imagem inserida por URL HTTPS; não há upload próprio de imagem de assinatura                                                   | Upload precisa de publicação HTTPS e ciclo de vida próprio, pois destinatários externos não têm sessão no APMail.         |
| Regras                | `equals` compara a representação `Nome <email>` ou toda a lista concatenada; normalização trata acentos/caixa, mas não espaços | Comparar somente um endereço de e-mail falha; espaços extras também causam falha.                                         |
| Permissões            | `TenantRole` tem owner/admin/member e há comparações `role !== 'member'` na API, worker, SQL e interface                       | Adicionar Supervisor sem revisar esses pontos lhe daria acesso administrativo indevido.                                   |
| Preferências          | Tema inclui sistema; densidade muda basicamente o padding das células; imagens remotas começam desativadas                     | Migrar defaults e retirar escolhas redundantes.                                                                           |
| Histórico             | Toda ingestão chama recomputação normal da conversa                                                                            | Mensagens antigas passam a ocupar filas como mensagens novas.                                                             |
| Data                  | `ThreadListItem` mostra dia/mês; horário fica no atributo title                                                                | Data e hora precisam aparecer na listagem.                                                                                |
| Convites              | Job `system-email` usa um único transporte SMTP global                                                                         | Implementar seleção do remetente por empresa e contexto do convite.                                                       |
| Contatos / plataforma | Não existem módulo de contatos, papel global ou painel de super admin                                                          | São módulos novos, apoiados no isolamento existente por empresa.                                                          |

Reprodução direta, sem modificar o motor de regras:

- Remetente `José Cliente <cliente@exemplo.com>` igual a `cliente@exemplo.com`: **false**.
- Lista de destinatários contendo `comercial@empresa.com` igual a esse endereço: **false**.
- Assunto `Orçamento aprovado` igual a `ORCAMENTO APROVADO`: **true**.
- Assunto com espaços nas extremidades, espaços repetidos e NBSP igual a `orcamento aprovado`: **false**.

### Ambiente verificado em 02/10/2026

Inspeção do `.env` do Compose APMail no Dokploy e dos containers API/worker: host, usuário, senha e remetente do SMTP global preenchidos; porta 587 e TLS implícito desativado. Verificação de autenticação com STARTTLS obrigatório aprovada. Nenhum e-mail foi enviado nessa análise; entrega ao destinatário ainda deve ser conferida na homologação.

Saúde pelo endereço HTTPS configurado: HTTP 200, status ok. Uma caixa ativa conectada. Serviços permanentes saudáveis. As cópias locais antigas de ambiente não devem sobrescrever a configuração atual do Dokploy.

## 3. Corpo da mensagem e editor

Reutilizar `RichTextEditor` no compositor e na assinatura, com perfis de funcionalidades por uso. Separar toolbar, diálogos e normalização HTML para evitar um componente que concentre todos os fluxos.

Controles propostos para conferência com o print:

- Família de fonte com opções adequadas ao HTML de e-mail e fallback definido; tamanho de texto.
- Negrito, itálico, sublinhado e tachado.
- Cor do texto e destaque/fundo, com opção de restaurar a cor padrão.
- Alinhamento à esquerda, centralizado e à direita; recuo quando suportado pelo HTML final.
- Listas com marcadores e numeradas, citação e separador.
- Inserir, editar e remover link; inserir imagem por URL ou upload conforme o perfil.
- Desfazer/refazer e limpar formatação.
- Inserção de tabela simples como proposta a confirmar no print; dimensionamento de imagem preservando proporção.

Famílias de fonte escolhidas para o corpo enviado são conteúdo do e-mail; a interface continua com Inter/JetBrains Mono e os tokens oficiais.

Requisitos: toolbar acessível por teclado, estado ativo da seleção, nomes acessíveis, foco preservado ao abrir controles e overflow organizado no mobile. Colagem de texto/HTML deve passar por normalização e sanitização. Fonte, cor, tamanho, alinhamento, imagem e tabela devem sobreviver ao ciclo editor → rascunho → API → MIME → destinatário. O sanitizador admite somente tags, atributos e estilos necessários; scripts, eventos e URLs executáveis continuam bloqueados.

Aceite: formatação preservada após autosave, recarga e envio; edição não perde assinatura/citação; respostas e encaminhamentos conservam o comportamento atual; envio real de homologação inspecionado em clientes representativos, inclusive tela pequena.

## 4. Upload de imagens de assinatura

Atualização de 05/10/2026: **anexar imagem → validar/normalizar PNG no servidor → armazenar → incorporar no MIME com CID**. A assinatura oferece somente upload, sem campo de URL de imagem. Links no texto continuam disponíveis.

- JPEG, PNG e WebP até 5 MB; orientação corrigida, limite de pixels e dimensões e retirada de metadados. Upload autenticado e vinculado ao usuário e à empresa.
- O editor e a prévia exibem o arquivo da aplicação; o HTML salvo/enviado usa CID. O destinatário recebe o arquivo como parte do e-mail, sem depender de carregamento remoto.
- A assinatura selecionada é incluída pela API/worker mesmo se um cliente fornecer apenas seu ID. O HTML do rascunho é um snapshot: reabrir, editar e enviar preservam assinatura/citação e não duplicam a assinatura.
- URLs antigas de imagens publicadas pelo APMail são convertidas automaticamente em CID no envio. URLs externas legadas continuam compatíveis; para incorporar uma imagem externa antiga, o usuário deve anexar seu arquivo. Nenhum servidor externo é consultado para baixar imagens automaticamente.
- Mensagens enviadas conservam arquivo, Content-ID e prévia na cópia em Enviados/IMAP. Respostas e encaminhamentos reutilizam apenas anexos autorizados. Não apagar imagens publicadas usadas em mensagens antigas.

Aceite: upload sem digitar URL, imagem visível na prévia/reabertura e no MIME recebido via SMTP, cópia IMAP íntegra, assinatura única, bytes PNG conferidos, isolamento por usuário/empresa e ausência de busca arbitrária de URLs.

## 5. Navegação e menu

Ordem proposta:

```text
Envios
  Rascunhos / Agendados / Na fila / Com falha
Chat
  Conversas e grupos
Dashboard
Contatos
Caixas de e-mail
  Nome da caixa
    Pastas
      Caixa de entrada / Enviados / Rascunhos / Spam / Lixeira / demais pastas
    Filas
      A responder / Em atendimento / Aguardando resposta / Agendado / Concluído / Fora do SLA
    Minhas etiquetas
Configurações
  Meu perfil / Preferências / Assinaturas / Etiquetas / Regras
  Equipe e acessos / Caixas de e-mail / Empresa / Auditoria, conforme permissão
```

Grupos com filhos recebem botão separado de expandir/recolher, `aria-expanded` e `aria-controls`. Itens sem filhos navegam diretamente. Recolher um grupo não troca de página. A sidebar inteira pode ser ocultada/restaurada no desktop; no mobile permanece o drawer, que fecha depois da navegação. O estado é persistido por usuário/empresa, incluindo caixas e grupos, sem interferir nas preferências de outras empresas.

Carregar pastas ao expandir a caixa, mesmo sem entrar nela; respeitar permissões e cache. Indicar item ativo e ancestrais relevantes. Revisar comandos de organização e restrições de pasta no desenho agrupado.

Todas as rotas internas usam TanStack Router, incluindo notificações e troca de empresa. A troca de empresa salva rascunhos, cancela consultas antigas, limpa dados da empresa anterior e reautoriza salas Socket.IO. Cada item de menu deve mudar de rota sem novo carregamento do documento; atualizar os dados da rota é esperado.

Investigação de Spam: conferir IDs, caminho IMAP completo, flags oficiais do provedor e origem do fallback por nome. Escolher pasta principal de forma estável, priorizando a indicação oficial. Se existirem duas pastas distintas, preservar acesso e diferenciar nomes/caminhos; ambas continuam excluídas das filas quando forem pastas de spam. Corrigir repetição de renderização por ID quando esse for o defeito. Não excluir pastas ou mover mensagens para corrigir apresentação.

Aceite: navegação sem requests de documento em cada item; expandir/recolher com mouse e teclado; preferência restaurada; sem perda de rascunho ou dados da empresa anterior; pastas com nomes parecidos distinguíveis, sem perda de mensagens.

## 6. Regras

### Semântica e apresentação

Renomear “Minhas regras” para **Regras pessoais**, com ajuda: organizam etiquetas/fixação do próprio usuário. **Regras da caixa** alteram o tratamento compartilhado: pasta, destaque, atribuição, encaminhamento e exclusão da fila.

Regras da caixa exigem administração da empresa/caixa ou autorização administrativa explícita de Supervisor para regras. Preservar o papel existente de administrador de caixa; essa interpretação de “admin” e a delegação explícita ficam visíveis na matriz. Membro comum mantém apenas regras pessoais. Toda operação é verificada na API e novamente no worker.

### Comparações

- Texto humano: normalizar Unicode, caixa, acentuação, espaços nas extremidades, espaços repetidos, tabulação, quebras de linha e NBSP. Remover caracteres invisíveis sem valor de apresentação definidos na política de normalização.
- Endereço: comparar o endereço individual normalizado; não retirar acentos indiscriminadamente nem remover pontos ou sufixos `+`, que podem identificar endereços diferentes.
- `from`: e-mail informado compara o endereço; valor com nome/endereço é interpretado como endereço; valor apenas textual compara o nome para igualdade. Busca parcial continua aceitando nome e endereço, com ajuda explícita.
- `to`, `cc` e `any_recipient`: operadores positivos correspondem a pelo menos um destinatário; `not_contains` exige ausência em todos. Nunca comparar a lista inteira com um endereço individual.
- `equals` significa campo completo normalizado, sem transformar igualdade em busca parcial. Para `Orçamento aprovado`, `orcamento aprovado` corresponde e `orcamento` não; este último caso usa “contém”.
- Preservar limites de tamanho, all/any, prioridade, parar processamento, idempotência e exclusões atuais de Spam/Lixeira.

Adicionar **Testar regra** em uma mensagem à qual o usuário tem acesso. Retornar resultado por condição e resumo das ações, sem executar movimentações, encaminhamento ou atribuição. A prévia usa o mesmo avaliador do worker. Expor motivo humano para condições que não correspondem e estados operacionais relevantes, sem corpos/segredos em logs.

Revisar também reprocessamento, autorização do criador, ações em sequência, atribuição, encaminhamento, recuperação após falha e revogação de acesso. Corrigir o avaliador não deve reenviar automaticamente todo o histórico; reaplicação permanece explícita e conserva a proteção contra duplicação.

Aceite: testes dos operadores por campo, acentos/espaços, múltiplos destinatários e listas vazias; simulação e worker concordam; regra pessoal só altera o próprio usuário; membro não administra regra compartilhada; Supervisor depende da capacidade concedida e da caixa autorizada.

## 7. Preferências e horário nas listagens

- Tema: somente Claro/Escuro. Proposta de default: Claro. Converter registros “sistema” para Claro e preservar escolhas explícitas de Escuro.
- Retirar o seletor de densidade. Usar densidade operacional única, compacta no desktop e com áreas de toque adequadas no mobile. Preservar paginação e preferências de colunas.
- Aplicar a novos usuários e, uma vez na migração, aos existentes: menções/atribuições/chat ativados, imagens remotas ativadas, notificações do navegador desativadas. O usuário pode alterar depois os controles mantidos no formulário. Preservar fuso horário.
- Retirar/compatibilizar campos antigos gradualmente, evitando quebra de clientes e rollback. Nunca solicitar permissão do navegador automaticamente na migração.
- Exibir **data + hora** nas listagens de caixa, busca, etiqueta, fila e pasta. Proposta: `02/10 14:35`, com ano visível quando necessário e valor completo acessível.
- A listagem por conversa usa a última mensagem legível ao usuário; listagem individual usa o instante daquela mensagem. Exibir no fuso do usuário, mantendo UTC no banco; manter ordenação pelo timestamp completo.

Aceite: defaults verificados para usuário novo/existente; carregamento remoto funciona em mensagens já sanitizadas e nas novas; texto/HTML continuam protegidos; datas consistentes em todas as visões, nos fusos e nos dois temas.

## 8. Histórico inicialmente sem fila

Separar **quanto importar** de **quanto classificar para atendimento**. No assistente de conexão, perguntar sobre classificação do histórico e oferecer número inteiro de 0 a 90 dias, padrão 0, com descrição clara das duas filas.

- N=0: nenhuma conversa passa para A responder/Aguardando resposta apenas por importar histórico.
- N=1…90: avaliar conversas com interação relevante na janela, limitada também ao histórico efetivamente importado. Última interação recebida de terceiro → A responder; última interação enviada por nós a terceiro → Aguardando resposta. Ignorar automatizados, Spam/Lixeira e exclusões por regra.
- Classificar por conversa depois de importar seus dados, e não alternar filas a cada mensagem histórica recebida fora de ordem. Preservar estados manuais, atribuição e envio agendado existentes.
- Registrar marco da importação inicial e contexto histórico/live, com checkpoints. Usar identidade IMAP, data interna e deduplicação para não tratar reimportação, movimento de pasta ou reset de UIDVALIDITY como mensagem nova.
- Mensagens realmente novas recebidas durante/depois da importação e envios realizados pelo usuário ativam o tratamento normal da conversa, inclusive quando ela começou com histórico sem fila.
- Não usar `queue_excluded=true` como atalho para todo o histórico: esse campo bloquearia também interações futuras. Introduzir elegibilidade/origem específica, compartilhada pelo cálculo de filas, contadores e SLA.
- Preservar filas atuais das caixas existentes. O novo comportamento não reclassifica retroativamente essas caixas e não reaplica a janela a cada sincronização.
- Exibir progresso e resultado da classificação; registro auditável. Definir corte ancorado no início da importação, sem deslocar a janela a cada retry.

Aceite: 0/1/90 dias e fronteiras de horário; envio/entrada históricos, conversa mista e mensagem nova durante importação; retry, reconciliação e UIDVALIDITY; contador e SLA não incluem histórico inelegível; mensagem nova coloca a conversa no fluxo normal.

## 9. Contatos por empresa

### Modelo e unicidade

| Entidade proposta     | Responsabilidade                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `contacts`            | Pessoa/contato, nome, dados gerais, empresa proprietária e escopo de exibição.                                    |
| `contact_emails`      | Vários endereços de e-mail de um contato; unicidade obrigatória por empresa e endereço normalizado.               |
| `contact_companies`   | Cadastros de empresas relacionadas, com CNPJ opcional, razão social/nome fantasia e origem dos dados consultados. |
| `contact_addresses`   | Endereços estruturados, cadastráveis por CEP ou manualmente.                                                      |
| `contact_email_links` | Vínculo de um e-mail específico com empresa e/ou endereço. Permite várias combinações e endereço sem empresa.     |
| `contact_mailboxes`   | Caixas nas quais um contato de escopo restrito pode aparecer.                                                     |

Usar FKs compostas com tenant e índices de busca; todas as referências pertencem à mesma empresa. Um mesmo CNPJ cadastrado na empresa pode ser reutilizado por vários contatos, preservando os vínculos de cada e-mail.

Exemplo: contato Ana tem `ana@empresa-a.com` vinculado à Empresa A/endereço A e `ana@empresa-b.com` vinculado à Empresa B/endereço B; `ana@pessoal.com` pode ter somente um endereço. O vínculo não é colocado genericamente no contato, pois isso perderia qual e-mail representa cada empresa/endereço.

`UNIQUE(tenant_id, email_normalized)` é a garantia final. Normalizar caixa/espaços/formato do endereço sem deduzir aliases. Verificar cada e-mail antes de criar e repetir a validação na transação. Dois cadastros concorrentes resultam em um vínculo e conflito 409 no outro, sem contato parcialmente criado.

E-mail já cadastrado e visível abre o contato existente; e-mail pertencente a contato restrito retorna orientação para procurar o administrador, sem revelar dados do contato. Se vários e-mails digitados pertencem a contatos diferentes, pedir resolução explícita; não fundir automaticamente. Remoção/reatribuição de e-mail exige transação e auditoria. Se houver arquivamento, ele conserva a reserva do endereço até liberação explícita.

### Visibilidade e edição

- Escopo padrão **Todas as caixas**, incluindo caixas conectadas depois. O contato fica salvo na empresa, não na caixa de origem.
- Administrador da empresa altera para caixas selecionadas por checkbox. Seleção vazia deixa o contato indisponível aos usuários comuns; administradores continuam podendo gerenciá-lo.
- Usuário com acesso a pelo menos uma caixa autorizada vê o contato completo, como confirmado. Essa permissão não concede acesso a mensagens de outras caixas.
- Usuários ativos podem criar/editar contatos visíveis; apenas administrador altera a exibição por caixa. Formulário de criação de membro usa o padrão Todas as caixas, sem permitir contornar uma restrição já existente por duplicação.
- Supervisor só ganha gestão de visibilidade se essa capacidade for concedida explicitamente; não decorre do nome do papel.
- Mesma filtragem na listagem, detalhe, busca por remetente, autocomplete e eventos em tempo real. Revogação remove dados do cache e salas de assinatura correspondentes.

### Fluxos

1. No remetente do e-mail, procurar endereço já vinculado. Exibir o contato ou ações **Criar contato / Vincular a contato existente**.
2. Criar a partir do remetente preenche nome/e-mail; salvar continua manual e exige a checagem de unicidade.
3. Vincular a contato existente adiciona somente o endereço ainda livre e os vínculos informados. Editar abre o mesmo formulário do módulo.
4. Menu **Contatos** oferece busca por nome/e-mail/empresa/CNPJ, filtros e paginação no servidor; cadastro independente permite adicionar e-mails e seus vínculos.
5. Editor por e-mail apresenta empresas e endereços associados, incluindo criação por CNPJ, consulta por CEP e preenchimento manual.

### CNPJ e CEP

Proposta: adaptador de CNPJ da BrasilAPI e adaptador de CEP do ViaCEP, consultados pelo servidor. Os dados consultados são sugestões editáveis, com fonte e data da consulta. Campos já editados pelo usuário não são sobrescritos silenciosamente. Nenhum serviço externo é a fonte da verdade dos contatos.

Validar formato/dígitos verificadores antes de consultar; timeout, limite por usuário, cache e tratamento de 400/404/429/indisponibilidade. Permitir cadastro manual quando a consulta falhar. CNPJ pode preencher empresa e endereço cadastral; CEP também cadastra endereço sem empresa e mantém número/complemento para preenchimento.

CNPJ é texto, aceitando formato numérico e alfanumérico: 14 posições, com dois verificadores numéricos. O novo formato já entrou em operação; não usar máscara que apaga todas as letras. [Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico), [formato oficial](https://www.gov.br/coaf/pt-br/sistemas/siscoaf/comunicados-siscoaf/atualizacao-do-portal-da-pessoa-obrigada-para-adequacao-ao-cnpj-em-formato-alfanumerico).

A documentação da BrasilAPI aceita CNPJ alfanumérico; conferir na homologação a disponibilidade do registro consultado. [Contrato CNPJ da BrasilAPI](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json). ViaCEP exige CEP de oito dígitos; formato inválido retorna 400 e CEP inexistente pode retornar `erro=true`. [Documentação ViaCEP](https://viacep.com.br/).

Aceite: contato com vários e-mails/empresas/endereços; endereço sem empresa; concorrência e duplicidade; duas empresas isoladas podendo cadastrar o mesmo endereço; visibilidade completa pela interseção das caixas; restrição aplicada em todos os endpoints; CNPJ numérico/alfanumérico, CEP inválido/inexistente, falha do provedor e edição manual.

## 10. Supervisor e convites

Supervisor é um papel **da empresa**, distinto do papel de acesso em cada caixa. Tem dashboard geral por padrão, limitado às caixas/pastas autorizadas; as demais capacidades administrativas continuam explícitas. Atribuir caixas e permissões de pasta continua sendo uma escolha explícita do administrador.

Capacidades propostas, com controle individual:

| Capacidade                         | Escopo                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Gerenciar regras da caixa          | Somente caixas autorizadas; aplica também a verificação do criador no worker.                                          |
| Atribuir atendimento a outros      | Somente conversas acessíveis e destinatários elegíveis da mesma empresa.                                               |
| Dashboard (padrão, sem concessão)  | Supervisor/Admin têm visão geral e filtro por usuário; Membro vê somente dados pessoais nas caixas/pastas autorizadas. |
| Ver auditoria                      | Eventos administrativos genéricos permitidos e eventos dos recursos acessíveis; sem dados de caixas restritas.         |
| Ver outros usuários                | Dados básicos da equipe atual; não concede edição de acesso nem convite.                                               |
| Gerenciar visibilidade de contatos | Concessão separada, caso desejada pelo administrador.                                                                  |

Administradores configuram essas capacidades no convite e na edição do usuário. Elas são persistidas por vínculo usuário/empresa, nunca globalmente no usuário. Supervisor não promove a si mesmo, não concede capacidades e não recebe automaticamente administração de todas as caixas. Editor/Leitor de caixa continuam definindo a base de operação.

Antes de habilitar o papel, substituir inferências negativas (`!= member`) por políticas explícitas na API, SQL, worker, Socket.IO e UI. Centralizar a autorização efetiva e testá-la para cada combinação; interface esconde ações, mas servidor e worker garantem a restrição. Revogação vale imediatamente, inclusive para jobs já agendados.

### Remetente do convite

- Empresa define sua **caixa principal para convites**. Inicialmente, sugerir a primeira caixa ativa elegível e permitir ao administrador escolher outra da própria empresa.
- Formulário mostra o remetente e oferece as caixas conectadas disponíveis. Sem caixa elegível, explicar a necessidade de conectar/configurar uma caixa antes de convidar. Administrador de empresa não usa SMTP global como fallback.
- Convites gerados no painel do super admin usam o SMTP global verificado. O contexto de plataforma é autorizado no servidor, nunca por um booleano livre recebido do browser.
- Job guarda IDs/contexto e resolve credenciais criptografadas no worker; não transportar senhas no payload Redis. Revalidar estado da caixa, empresa e permissão de envio antes do SMTP.
- Reenvio mantém o contexto e a política de remetente; caixa removida/inativa produz orientação e nova escolha, sem trocar silenciosamente para remetente global.
- Convites continuam com token de uso único, validade, revogação, proteção de último proprietário e auditoria. Falha de entrega fica visível e pode ser reenviada; não registrar convite como entregue somente porque entrou na fila.
- Recuperação de senha continua pelo SMTP global, pois acontece antes de selecionar empresa; não trocar esse fluxo implicitamente junto com convites.

Aceite: Supervisor sem capacidade recebe as mesmas restrições de Membro; conceder/revogar cada capacidade altera UI/API/worker corretamente; nenhuma informação de caixa restrita aparece em auditoria/dashboard; convite da empresa usa sua caixa; sem caixa bloqueia; convite de plataforma usa global; retry preserva contexto e não duplica aceite.

## 11. Super admin da plataforma

Associação global separada dos papéis da empresa, bootstrap por comando administrativo no servidor e painel próprio `/superadmin`. Cadastro público, convite comum ou edição de membro não concedem super admin.

Gestão global: criar/listar empresas, acompanhar estado/suspensão, designar proprietário por convite, gerenciar usuários/vínculos e caixas, consultar auditoria global e saúde/logs operacionais. Configurações de credenciais permitem substituir/testar credenciais sem devolver senhas existentes.

O superadmin atua exclusivamente na plataforma. Mesmo que a conta tenha vínculos antigos como proprietário/admin ou permissões de caixa, não consulta mensagens, anexos privados, contatos, chat, notificações empresariais nem o dashboard operacional, e não envia ou organiza e-mails. Rotas operacionais redirecionam para /superadmin; API e Socket.IO negam acesso. O bootstrap verifica Redis e publica uma revogação isolada pelo banco lógico; cada API encerra conexões locais já abertas da conta promovida. A operação de caixas exige uma conta empresarial separada.

O modo de suporte com acesso a conteúdo foi retirado conforme solicitação de 05/10/2026. Sessões legadas não concedem contexto empresarial; iniciar suporte retorna 403. O histórico das sessões e auditorias permanece consultável. A API global não concede acesso empresarial nem envia convites de empresa a outra conta superadmin; criação de empresa exige proprietário comum. Vínculos antigos são preservados para evitar apagar histórico ou violar a proteção do último proprietário.

Armazenamento: nova seção em /superadmin e GET /api/superadmin/storage, exclusiva do papel global. Duas visões: empresas e caixas, com busca, ordenação validada, paginação 10/20/30/50/100, totais do conjunto filtrado e detalhamento das caixas de uma empresa. Permite priorizar a futura definição de planos a partir do uso registrado.

Contrato da métrica: soma bytes UTF-8 dos corpos das mensagens e outbox com tamanho registrado dos anexos, uploads pendentes e imagens de assinatura. HTML de assinaturas, uploads e imagens próprias são compartilhados da empresa e não atribuídos artificialmente a uma caixa. Caminhos de arquivo repetidos contam uma vez, com preferência de atribuição ao anexo de caixa. Metadados de uploads consumidos não contam, pois o worker remove seu arquivo fonte após o envio. Registros excluídos logicamente continuam contando enquanto retidos. O tamanho original MIME fica separado e não entra na soma com anexos. Totais/página vêm de um único snapshot SQL.

Os valores são estimativas de payload registrado: não representam RAM nem o tamanho físico completo do volume. Índices, TOAST/compressão, WAL, demais tabelas/metadados, avatares, arquivos órfãos e backups não são distribuídos por empresa nessa métrica. O painel identifica essa limitação; antes de definir cobrança por disco físico, será necessário incluir inventário/retenção e conciliação com o volume. A consulta não lê corpos, caminhos ou arquivos para devolvê-los ao superadmin: retorna somente somas, contagens e identificação cadastral.

Auditoria registra mudanças administrativas, concessões e suspensão, preservando eventos de suporte anteriores. Logs estruturados correlacionam serviço/request_id/job_id e tenant quando conhecido, com consulta paginada e campos permitidos. Credenciais, cookies, tokens e conteúdo de mensagens não devem ser expostos no painel.

Suspensão de empresa bloqueia novas operações, revoga sessões/salas pertinentes e impede novos jobs/envios; retomada controla a drenagem dos pendentes. Evitar exclusão irreversível como operação inicial de gestão.

Aceite: owner/admin de empresa não abrem endpoints globais; superadmin gerencia empresas sem acessar conteúdo, inclusive com vínculos antigos ou suporte legado; métricas de armazenamento são exclusivas da plataforma e não duplicam MIME/anexos; revogação/suspensão alcançam HTTP/socket/worker; logs não expõem segredos; bootstrap não depende de cadastro público.

## 12. Plano de execução para uma entrega conjunta

| Etapa                            | Trabalho                                                                                                                    | Dependências / saída verificável                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 — Fechar referência            | Conferir print, toolbar e matriz administrativa proposta                                                                    | Decisões confirmadas e cenários de aceitação congelados.                      |
| 2 — Base de autorização          | Centralizar políticas e revisar todos os caminhos `!= member`; definir Supervisor/plataforma                                | Testes provam que papel novo sem concessão não vira administrador.            |
| 3 — Dados e contratos            | Migrations novas para capacidades, contatos/vínculos/visibilidade, importação, assets, remetente e suporte; tipos e schemas | Aplicação sobre cópia restaurada de dados reais; migrations antigas intactas. |
| 4 — Núcleo de regras e histórico | Avaliador, simulação, ingestão/elegibilidade, jobs e contadores                                                             | Casos reproduzidos corrigidos; histórico não ocupa fila por acidente.         |
| 5 — Contatos                     | Serviços/APIs, unicidade, consultas CNPJ/CEP, permissões e realtime                                                         | Fluxos com várias associações, conflito concorrente e isolamento aprovados.   |
| 6 — Imagens e editor             | Upload/publicação HTTPS, toolbar/extensões e HTML/MIME                                                                      | Formatação e assinatura verificadas até o destinatário.                       |
| 7 — Interface                    | Sidebar/grupos/SPA, contatos/remetente, preferências, horário, regras e editor de acesso                                    | Desktop/tablet/mobile, Claro/Escuro, teclado e estados de dados revisados.    |
| 8 — Convites e plataforma        | Seleção SMTP por contexto, painel global, armazenamento, auditoria e logs                                                   | SMTP correto por origem e fronteiras globais testadas.                        |
| 9 — Homologação integrada        | Suite completa, fluxos multissessão, carga representativa e Docker                                                          | Critérios de todos os módulos satisfeitos em stack isolada.                   |
| 10 — Publicação única            | Backup, CI, merge/tag, migração e redeploy conjunto                                                                         | Saúde, dados, filas, acesso, SMTP e assets conferidos após publicação.        |

Uma branch de implementação reúne os módulos e commits por responsabilidade. Etapas internas não representam releases parciais em produção. O plano não estabelece prazo numérico antes de fechar a referência do editor e validar o volume do histórico/contatos.

## 13. Estratégia de migração, QA e publicação

- Preservar usuários, empresa, caixa conectada, mensagens, anexos, regras e filas atuais. Restaurar backup em ambiente isolado para testar migrations, sem executar reset no banco de produção.
- Atualizar tipos a partir do banco migrado e validar payloads de API/job com Zod. Restrições de tenant, unicidade e FKs no banco complementam os guards da aplicação.
- Conservar campos antigos durante a transição quando forem necessários ao rollback; não modificar SQL de migrations já aplicadas. Migração de preferências é explícita, e a de histórico preserva a elegibilidade das conversas existentes.
- Testes unitários focam normalização, comparação e cálculo de elegibilidade/permissões. Integração usa Postgres/Redis/IMAP/SMTP reais de QA para concorrência, autorização, jobs e recuperação.
- E2E: empresa/usuários → Supervisor → caixa → histórico → regra → contato → resposta formatada/assinatura → convite → dashboard/auditoria → gestão global, armazenamento e bloqueio de contas globais na operação. Testar também duas empresas e dois navegadores simultâneos.
- Desktop/tablet/mobile nos temas Claro/Escuro: foco, teclado, áreas de toque, um h1, contraste, redução de movimento, estados loading/vazio/erro/sem permissão. Tabelas reutilizam o contrato de paginação/filtros/colunas do projeto.
- Conferir ausência de recargas de documento na navegação, preservação de rascunhos e ausência de conteúdo indevido em cache depois de troca/revogação.
- Inspecionar bundle, logs e jobs para segredos. Imagem publicada de assinatura é acessível sem sessão; anexos privados continuam protegidos.
- Executar lint, typecheck, testes aplicáveis, build, migrations, CI e Docker; verificar migration exit 0, healthchecks, UIDs, WebSocket e persistência.
- Antes do redeploy, capturar ambiente atual do Dokploy com segurança e fazer backup consistente. Preservar domínio/SMTP já configurados; cópias antigas do workspace não são fonte de verdade para esses valores.
- Após a publicação, validar login, capacidades, caixa ativa, filas existentes, data/hora, contatos, editor, assinatura HTTPS e convites com destinatários de homologação definidos. Rollback exige compatibilidade de schema e versão; não apagar dados nem migrations.

## 14. Checklist de fechamento do plano

- [x] Código atual analisado e falhas de comparação reproduzidas.
- [x] Decisões sobre contatos, histórico, densidade e super admin confirmadas.
- [x] Política distinta de SMTP para administradores de empresa e plataforma confirmada.
- [x] `.env` e containers do servidor conferidos; autenticação/TLS SMTP e saúde HTTPS aprovadas, sem envio de e-mail.
- [x] Requisitos, contratos, dependências, migração e critérios de aceitação documentados.
- [x] Controles do editor implementados conforme solicitação textual; print ausente registrado.
- [x] Implementação conjunta autorizada pelo usuário, incluindo `/superadmin`.

### Ajustes confirmados na implementação

- CNPJ: BrasilAPI como fonte principal, com Minha Receita em falhas de disponibilidade, mantendo dados manuais e indicação da fonte. [Contrato da fonte alternativa](https://docs.minhareceita.org/como-usar/).
- Corpo do e-mail: imagens anexadas privadas com CID; assinatura: imagens normalizadas em PNG e URL pública HTTPS imutável.
- Superadmin: escopo exclusivo da plataforma, conforme revisão de 05/10/2026; suporte a conteúdo retirado e auditorias históricas preservadas.
- A stack existente React/Vite/TanStack Router + Fastify/Postgres foi preservada. As diretrizes visuais e de acesso do AGENTS.md foram aplicadas; migração integral para TanStack Start/Supabase não integra esta alteração de produto.

## Complemento de 05/10/2026: dashboard e validação das caixas

Dashboard disponível para todos por padrão. Membros veem seus próprios envios, recebidos de atendimentos atualmente atribuídos, filas atribuídas e conclusões realizadas por eles. Supervisores, administradores e proprietários podem consultar o conjunto permitido ou filtrar por usuário, caixa e período. Restrições de caixa e pasta valem para todos os gráficos, indicadores, produtividade, conversas antigas e CSV. Membro não pode usar um parâmetro de usuário para consultar terceiros. Sem caixa permitida, a tela continua disponível com dados vazios. A configuração antiga de capacidade dashboard é mantida apenas por compatibilidade e sai dos controles de concessão.

O assistente de cadastro testa e autentica IMAP/SMTP na etapa Servidor. A API testa novamente os dados finais antes de gravar a caixa e suas credenciais. O mesmo controle se aplica ao superadmin e a alterações de conexão/senha; uma falha mantém a configuração anterior e não inicia importação. O teste SMTP verifica autenticação sem enviar mensagem. Produção exige TLS/STARTTLS com certificado válido; exceções de laboratório só são aceitas em desenvolvimento e hosts explicitamente autorizados.

Validação: lint, tipos, build, 51 testes unitários e 70 de integração com PostgreSQL/Redis/IMAP/SMTP reais. Revisão de navegador e publicação registradas em PROGRESSO.md.

## Complemento de 05/10/2026: superadmin exclusivo e armazenamento

Implementado em código local, com commit e deploy a cargo do usuário. Não há nova migração nem alteração automática dos cadastros em produção. Antes da publicação, manter um proprietário/admin empresarial comum para a operação: contas concedidas como superadmin, incluindo proprietários antigos, passam a entrar somente em /superadmin. Novos envios e ações pendentes revalidam essa fronteira no worker.

## Complemento de 05/10/2026: gestão por empresa e rolagem do menu

O painel /superadmin inicia na lista de empresas. Depois de selecionar uma, mantém seu nome visível e libera cadastro da empresa, usuários, caixas, armazenamento, auditoria e logs referentes a ela. Trocar empresa retorna ao seletor; URL, busca e paginação preservam o contexto. O cache não apresenta dados da empresa anterior enquanto a nova carrega. Saúde da plataforma continua global.

- Empresas: criar com proprietário existente ou convidado, editar nome/identificador, suspender e reativar.
- Usuários: criar conta com senha inicial e papel na empresa, configurar caixas/capacidades na etapa seguinte, editar nome/e-mail/senha, convidar por SMTP global e ativar/desativar o vínculo selecionado. Conta já existente é vinculada por convite, evitando redefinir sua senha durante cadastro. Nome/e-mail/senha pertencem à identidade compartilhada; o formulário informa que afetam todas as empresas da conta. Alterar e-mail/senha encerra as sessões atuais. O último proprietário ativo é protegido.
- Caixas: adicionar e editar configuração IMAP/SMTP, remetente e cópia em Enviados. Senha existente nunca é retornada. Campos de conexão/senha alterados são autenticados antes da gravação; falha preserva configuração/credenciais anteriores. Campos omitidos em edição parcial permanecem intactos.
- As listagens de usuários e caixas exigem tenant_id na API, validado como UUID. Cadastros e permissões são conferidos no servidor; contexto incorreto retorna 404. Contas globais não aparecem como usuários operacionais nem recebem permissões de caixa. Gestão cadastral não concede leitura de mensagens.
- Menu lateral: ScrollArea existente com indicador vertical fino, neutro e exibido durante interação; mesma solução no painel lateral de desktop e no menu móvel. Roda do mouse, toque e foco por teclado continuam funcionais nos dois temas.

Entrega local, sem commit/push/deploy e sem migração adicional. A stack existente foi preservada; as diretrizes visuais e de acessibilidade do AGENTS.md orientam os componentes reutilizados.

## Plano de 05/10/2026: consumo verificável e dashboard da plataforma

Especificação completa em [PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md](PLANO-ARMAZENAMENTO-DASHBOARD-SUPERADMIN.md). Status: **fases 0–6 implementadas no workspace**, com publicação pelo usuário. Contratos efetivos, fontes de coleta e comandos em [OPERACAO-ARMAZENAMENTO.md](OPERACAO-ARMAZENAMENTO.md). Limpeza de produção e evidências em [PROGRESSO.md](PROGRESSO.md).

O objetivo é conferir arquivos existentes no disco e atribuir seu uso à empresa/caixa correta, ampliar o catálogo de dados lógicos, registrar retenção/divergências e manter histórico de crescimento. Arquivos compartilhados ficam separados; avatares globais e componentes de infraestrutura não são atribuídos arbitrariamente a clientes. Banco físico compartilhado, índices/WAL, backups, logs, Redis e capacidade dos volumes aparecem como infraestrutura, sem somá-los novamente ao conteúdo lógico ou apresentar rateio como consumo físico exato.

O dashboard terá visão geral de consumo/crescimento, empresas/caixas/usuários, saúde/fila/sincronização/envios, capacidade, integridade e atividade administrativa. Detalhes por empresa e caixa preservam contexto e permissões. A visão global mostra somente metadados e indicadores; gerenciar usuários/caixas continua exigindo selecionar a empresa. Superadmin não recebe acesso a mensagens ou anexos.

Sequência concluída: inventário/contrato → cadastro central e preenchimento legado → ciclo de vida dos arquivos → reconciliação/histórico → infraestrutura/APIs → dashboard → homologação. Bytes exatos, fórmulas versionadas, metadados exclusivos da plataforma, fontes indisponíveis e limites físicos do banco compartilhado são apresentados explicitamente. Imagens novas de assinatura são privadas com prévia autenticada e envio CID; imagens públicas antigas permanecem marcadas como legado. A entrada de /superadmin passa a ser a visão geral, mantendo a escolha da empresa antes da gestão de usuários/caixas. Não há planos, preços, cotas comerciais, bloqueios por consumo ou limpeza automática nova. Commit e deploy continuam com o usuário.

## Complemento de 05/10/2026: limites do menu e barras operacionais

- O conteúdo do menu lateral fica limitado à largura do painel, inclusive no menu móvel. Texto longo pode ser abreviado visualmente, com nome completo disponível, sem empurrar setas, contadores ou opções para fora da área visível. Grupos continuam recolhíveis, e a navegação completa pode ser ocultada/restaurada.
- Na caixa, busca e atualização compartilham uma linha; responsável e ordenação usam campos alinhados com rótulos acima. Seleção da página e filtro de não lidas aparecem juntos; limpar filtros informa a quantidade e preserva o contexto da pasta/fila/etiqueta e a navegação sem recarga.
- Na conversa, status, atribuição, compartilhamento e etiquetas compõem a mesma barra, com altura consistente e distribuição adaptada à largura do painel. Organizar reúne mover/restaurar/excluir; Mais ações reúne marcar como não lida e fixar/desafixar. A identificação do responsável não se repete.
- Diálogos preservam confirmação de exclusão e retorno de foco ao botão de origem. As barras usam tokens de tema, rótulos acessíveis, foco visível e controles de 44 px em celulares. Mantidos os contratos de dados e as permissões existentes; publicação a cargo do usuário.
