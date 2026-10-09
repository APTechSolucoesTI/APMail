# Plano — contatos por usuário, importação Outlook e etiquetas por caixa

## Entrega e decisões finais — 07/10/2026

Fases 0–6 implementadas. A confirmação final determina **bloqueio de nome global repetido**, além de e-mail repetido. A comparação desconsidera caixa, acentos e espaços repetidos; agendas individuais mantêm unicidade por proprietário. E-mail e telefone são validados na ficha, API e importação, com telefones normalizados em E.164.

Empresa/Cargo são textos com autocomplete. Cadastros, relações e legado do antigo diretório são removidos pela migration 0023; endereços opcionais ficam no contato. Modo administrativo só afeta novos contatos. Autoria histórica sem evidência aparece como não registrada.

Importação CSV/VCF possui prévia, mapeamento, diagnóstico, política imutável de duplicatas após início, lotes de até 100, cursor transacional, interrupção entre lotes, retomada e relatórios privados disponíveis por 24 horas. Atualização não apaga campos preenchidos quando o arquivo traz valores vazios e preserva canais e endereços existentes. Disponíveis modelos CSV/VCF em Contatos → Importar. Limites: 10 MiB/10.000 registros; prévia apresenta os primeiros 100, validando todos.

Listagens usam filtros por coluna, ordenação, Colunas e paginação. Dados não limitados são filtrados no servidor antes do total/paginação. Inclui contatos, histórico, envios, chat, configurações, dashboards e superadmin; históricos/gráficos agregados já limitados usam paginação local. Preferências isoladas por usuário e listKey, inclusive no superadmin. **Revisão de 09/10/2026: listagens operacionais de e-mails são a exceção**, com formato de conversas, busca no topo, seleção e paginação; não recebem filtros por coluna nem configuração de colunas, inclusive em pastas/filas/etiquetas/busca.

Etiquetas globais vêm primeiro, têm disponibilidade Todas/Selecionadas e contadores restritos à caixa/pastas. Regras pessoais só usam pessoais; regras da caixa só globais. Mudanças de disponibilidade desativam regras incompatíveis e ocultam aplicações antigas sem apagá-las.

Validação e instruções de publicação: [PROGRESSO.md](PROGRESSO.md), [DEPLOY.md](DEPLOY.md). Commit/deploy pelo usuário; produção não foi alterada nesta entrega.

Data: 07/10/2026. Status: **implementado no workspace; publicação pelo usuário**.

Este plano registra o novo pedido e substitui, nos pontos abaixo, as regras da entrega [anterior](PLANO-CONTATOS-ETIQUETAS-ENVIO.md). As fases foram implementadas com a migration `0023_contacts_outlook_label_mailboxes.sql`. Commit e deploy continuam com o usuário. Os prints orientam a listagem, seus filtros e a configuração de colunas; a compatibilidade com Outlook orienta os campos de contato, sem exigir copiar seu design.

## 1. Regras solicitadas

| Área                    | Novo comportamento                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contatos globais        | Compartilhados dentro da tenância. Todos os usuários operacionais podem criar, visualizar e editar.                                                                                                                        |
| Contatos individuais    | Pertencem a um usuário, independentemente das caixas de entrada. Nenhuma relação de visibilidade por caixa.                                                                                                                |
| Modo de novos cadastros | Global ou Individual, definido pelo proprietário/admin em Configurações → Empresa e obrigatório para todos os novos contatos. Aplicável também à importação e à criação pelo remetente, sem escolha de escopo por contato. |
| Autoria                 | Ficha mostra quem criou e quando, além de quem fez a última alteração e quando, com data e hora.                                                                                                                           |
| Mudança do modo         | Afeta somente cadastros futuros. Antigos mantêm seu escopo, inclusive individuais quando o admin passa para Global. Aviso explícito antes de salvar a configuração.                                                        |
| Apelido                 | Continua privado por usuário; não altera nome cadastral, autoria compartilhada ou conteúdo enviado.                                                                                                                        |
| Empresa do contato      | Um campo de texto, opcional, assim como Cargo. Sem cadastro independente, tabela de empresas do diretório ou múltiplos vínculos.                                                                                           |
| Empresa e Cargo         | Autocomplete com valores já utilizados e pesquisa parcial `ILIKE`, para reutilizar a grafia existente.                                                                                                                     |
| Endereços               | Opcionais, vários por contato, diretamente na ficha. Sem vínculo com empresa ou e-mail.                                                                                                                                    |
| Importação              | Botão Importar na listagem de Contatos; arquivos CSV de Outlook e VCF/vCard, com prévia e validação.                                                                                                                       |
| Listagens               | Filtros no cabeçalho de cada coluna, ordenação, botão Colunas e paginação como padrão para todas as listagens de registros.                                                                                                |
| Etiquetas               | Globais primeiro, pessoais depois, sem intercalar os escopos. Manter cor livre e identificação de escopo.                                                                                                                  |
| Caixas da etiqueta      | Seleção das caixas onde vale; pessoal configurada pelo dono, global pelo proprietário/admin.                                                                                                                               |
| Minhas regras           | Ação de etiqueta aceita somente etiquetas pessoais do usuário e válidas na caixa da regra.                                                                                                                                 |
| Regras da caixa         | Ação de etiqueta aceita somente globais válidas na caixa. Gestão por admin/proprietário ou supervisor autorizado.                                                                                                          |

“Global” sempre significa **da tenância**, nunca de toda a plataforma. O cadastro de tenâncias, Configurações → Empresa e a gestão de empresas clientes no superadmin permanecem: a remoção solicitada é do diretório de empresas vinculadas a contatos.

## 2. Confirmações e pontos em aberto

Confirmações recebidas nesta revisão:

- O modo Global/Individual é obrigatório para todos os novos cadastros, definido pelo admin. Não há escolha individual no formulário.
- Mudança de modo afeta somente novos contatos; antigos não são convertidos. O admin deve receber aviso destacado e inequívoco.
- Global exige verificar nome existente e e-mail já vinculado antes de criar; Individual é uma agenda independente de cada usuário.
- Contato admite vários endereços opcionais.
- Dados antigos são de teste e podem ser descartados: não é necessário copiar empresas, CNPJ, endereços ou dados retirados para legado.

| Ponto                                | Recomendação para fechar a implementação                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mesmo e-mail em agendas individuais? | “Cada um por si” indica permitir em agendas de usuários diferentes, com unicidade na agenda de cada proprietário. Aplicado como agendas independentes por usuário; não revelar duplicidades privadas alheias. |
| Nome igual no global?                | Confirmado: bloquear nomes repetidos normalizados, sem exceção de homônimo. Usar nome completo e apelido individual para identificação; e-mail repetido também é bloqueado.                                        |

Políticas propostas adicionais: contatos existentes que forem mantidos conservam seu escopo; mudar o modo não converte registros anteriores. Contatos individuais permanecem privados inclusive perante admins operacionais. Supervisores mantêm apenas capacidades explicitamente concedidas. A exclusão global mantém a autorização de gerenciamento já existente; edição compartilhada não concede exclusão automaticamente.

## 3. Contatos: escopo, formulário e autoria

### 3.1 Acesso e alterações de escopo

Modelo com `scope=tenant/personal` e proprietário obrigatório apenas no individual. Criador e proprietário são conceitos separados. O servidor obtém autoria pela sessão, rejeita atribuição indevida a outro usuário e filtra todas as leituras antes de retornar resultados, sugestões, totais ou histórico.

Agenda apresenta globais + individuais do solicitante, identificados por escopo histórico. O modo atual determina somente o escopo de criação, não o acesso aos contatos antigos. Sem contatos individuais alheios em busca, autocomplete, seleção de destinatário, criação pelo remetente, exportação, importação, auditoria compartilhada ou eventos. Cache sempre inclui tenância e usuário. Superadmin mantém gestão da plataforma, sem leitura operacional da agenda ou mensagens.

Não oferecer conversão de escopo ou publicação individual nesta entrega. O registro recebe o modo vigente ao ser criado e conserva esse escopo. A API rejeita tentativa de escolher/alterar escopo por payload. Apelidos continuam pessoais em qualquer modo.

Ao trocar o modo, exibir antes de salvar: “Esta mudança vale somente para novos contatos. Contatos existentes mantêm sua visibilidade. Seus contatos individuais anteriores não serão compartilhados.” Aplicar a regra nos dois sentidos. Revalidar modo ao confirmar importação; se mudou desde a prévia, pedir nova revisão antes de gravar.

### 3.2 Campos alinhados ao Outlook

Reutilizar os componentes e temas atuais. Campos frequentes primeiro; demais em seções expansíveis. Empresa e Cargo são textos únicos, sem seletor de entidades ou consulta CNPJ.

| Grupo        | Campos propostos                                                                                  | Correspondência de importação                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Nome         | Nome de exibição; nome, nome do meio, sobrenome; prefixo/sufixo opcionais                         | CSV com cabeçalhos mapeados; vCard `FN`/`N`                                                            |
| Profissional | Empresa, Cargo, Departamento, escritório/local de trabalho opcionais                              | CSV Company/Job Title/Department; vCard `ORG`/`TITLE`/`ROLE`, conforme significado                     |
| E-mails      | Vários endereços, um principal, identificação de tipo quando presente no arquivo                  | CSV E-mail Address/E-mail 2/E-mail 3 e variantes localizadas; vCard `EMAIL`                            |
| Telefones    | Vários números, título/tipo e um principal                                                        | Comercial, comercial 2, celular, residencial, fax, outros; vCard `TEL`                                 |
| Complementos | Observações, site e aniversário opcionais                                                         | CSV correspondente; vCard `NOTE`/`URL`/`BDAY`                                                          |
| Endereços    | Vários, opcionais, identificados como comercial/residencial/outro; sempre pertencentes ao contato | CSV de endereço e vCard `ADR`; sem recriar empresa/endereço independente                               |
| Particular   | Meu apelido                                                                                       | Não importar para todos. `NICKNAME` só poderá preencher o apelido do importador com escolha explícita. |
| Sistema      | Escopo, criado por/em, alterado por/em                                                            | Definidos pelo APMail; datas externas não substituem autoria interna.                                  |

Não alegar que existe um único layout de CSV Outlook: nomes de colunas variam por idioma/versão. Manter mapeamento explícito e modelos de exemplo. Não derivar cargos de categorias automaticamente ou criar novas funcionalidades de “Situação” a partir do print.

Proposta de validação para compatibilidade: nome obrigatório e pelo menos um canal utilizável, e-mail ou telefone. Contato somente com telefone pode existir; Enviar e-mail fica bloqueado até cadastrar um destinatário. Linhas sem nome/canal vão para correção na prévia. Endereços são opcionais, múltiplos e não associados a empresas/canais. Campos importados fora do modelo aprovado são identificados na prévia, nunca descartados silenciosamente.

### 3.3 Autoria visível e confiável

Na ficha, apresentar um bloco compacto, disponível a todos que podem ver o contato:

- Criado por: nome do usuário; data e hora no fuso das preferências.
- Última alteração: nome do usuário; data e hora. Na criação, ambos representam a mesma operação.
- Em importação, usuário importador é o criador/último editor dos registros inseridos. Atualização de existente preserva criador/data originais.

Salvar alteração compartilhada e auditoria na mesma transação. Atualização apenas do apelido não muda Última alteração do contato compartilhado. Prevenir perda silenciosa entre dois usuários editando: versão/`updated_at` no salvamento e aviso de conflito antes de substituir dados recentes.

Preservar autoria histórica quando comprovada pelo banco/auditoria. Se não houver evidência do último editor, mostrar “Não registrado no histórico”, sem inventar autoria. Usuário desativado/removido conserva identificação histórica adequada, sem expor dados de outra tenância.

## 4. Empresa e Cargo: texto com autocomplete

Consultar os valores dos próprios contatos autorizados, sem tabela de cadastro de empresas/cargos. Empresa global e Cargo global podem contribuir para sugestões da equipe; individuais contribuem somente para seu dono.

1. Normalizar Unicode, espaços nas extremidades e repetidos; comparação sem distinção de caixa/acentos quando possível.
2. Consultar parcial com `ILIKE` e parâmetros; escapar `%`, `_` e barra para tratá-los como texto do usuário.
3. Priorizar igualdade normalizada, prefixo e depois trecho; deduplicar sugestões pela forma normalizada. Resultado mostra a grafia salva, não texto todo em minúsculas.
4. Debounce de 300 ms, respostas obsoletas canceladas/ignoradas, limite inicial de 20 sugestões, operação por teclado e estados vazio/carregamento/erro.
5. Permitir texto novo. Ao salvar variante equivalente, reutilizar a grafia visível já existente; não fundir empresas diferentes porque uma contém o nome da outra.

`ILIKE` ajuda a encontrar candidatos, mas não garante deduplicação. Comparação exata normalizada e salvamento transacional devem tratar variantes equivalentes, inclusive inserção concorrente. A privacidade prevalece: não consultar valores privados de terceiros para padronizar a grafia do usuário atual. Sem alteração automática de todos os contatos quando um campo é editado.

Busca de contato e filtro da coluna Empresa consultam diretamente esse texto; Cargo recebe o mesmo tratamento. Consultas CNPJ e balão Info da entidade empresa deixam de fazer parte do formulário.

## 5. Importação CSV/VCF

Funcionalidade disparada pelo usuário em Contatos → Importar. Não acessar ou importar dados de APTicket, Outlook ou outros sistemas automaticamente.

Fluxo: selecionar arquivo → identificar formato/codificação → mapear colunas → exibir modo obrigatório definido pelo admin → prévia com novos/existentes/inválidos → escolher tratamento de duplicados → confirmar → progresso e relatório. Não permitir selecionar outro escopo para novos registros.

### CSV

- Suportar arquivos exportados pelo Outlook, UTF-8/BOM, vírgula, aspas, campos multilinha e cabeçalhos em português/inglês. Detectar ponto e vírgula de arquivos editados regionalmente como compatibilidade do APMail; não tratá-lo como exigência do Outlook.
- Codificação diferente de UTF-8 exige detecção/escolha explícita e prévia legível, sem gravar caracteres corrompidos.
- Mapeamento manual com sugestões; preservar zeros iniciais e telefone como texto. Nome composto e vários canais tratados corretamente.

### VCF

- vCard 3.0 e 4.0, vários cartões no arquivo, linhas dobradas, escapes, tipos de telefone/e-mail, preferência/principal e Unicode.
- Mapear organização para Empresa e cargo para Cargo. Componentes adicionais de organização não viram várias empresas vinculadas.
- Campos repetidos, versões/propriedades não suportadas e conteúdo inconsistente recebem relatório. Não buscar recursos externos de `PHOTO`, `URL` ou outros campos durante a importação; foto fora desta entrega.

### Duplicados, permissões e consumo

- Usar todos os e-mails normalizados e verificar nome existente no escopo da criação. Global: e-mail já vinculado a outro global bloqueia novo cadastro; nome equivalente também bloqueia novo cadastro. Individual: comparar apenas com a agenda do próprio usuário. Sem e-mail, propor correspondência por telefone normalizado + nome; nunca fundir automaticamente pessoas só por nome/empresa/telefone.
- Duplicado visível: ignorar ou atualizar após revisão. Atualização não substitui valores existentes por vazios sem escolha expressa; preserva criador, apelidos de terceiros e canais adicionais.
- Uma linha que colide com vários contatos vai para resolução, sem fusão silenciosa. Duplicados dentro do arquivo também são detectados.
- Caso a mesma pessoa exista como global e individual, apresentar o escopo de cada candidato e pedir destino explícito para atualização. Não modificar global por acidente.
- Revalidar permissões, modo da tenância e cota em cada lote. Autor/tenância vêm da sessão. Importação idempotente, com identificador de execução e resultado por linha, para retentar sem duplicar.
- Proposta inicial: 10 MiB e 10 mil contatos por arquivo, processamento em lotes de 100. Valores são limites técnicos ajustáveis, não planos comerciais. Validar limites antes de persistir.
- Jobs, prévia e arquivos temporários privados e contabilizados; excluir arquivo temporário e conteúdo da prévia após confirmação/cancelamento/expiração, mantendo relatório enxuto de resultados. Cota insuficiente interrompe antes do lote bloqueado e informa o que foi salvo; permitir retomar sem sobrescrever resultados.

Modelo de CSV de exemplo e instruções de VCF fazem parte da entrega. Exportação completa da agenda fica fora deste pedido; download de relatório da importação não pode expor contatos privados alheios.

## 6. Padrão de todas as listagens

Evoluir `ConfigurableTable`, `ColumnSettingsDialog`, paginação e contratos compartilhados existentes, preservando a arquitetura do projeto. Aplicar o padrão também a listagens especializadas, com contrato visual equivalente quando não puderem usar a mesma tabela.

### 6.1 Cabeçalhos, filtros e ordenação

- Coluna com título, indicador de ordenação e botão de filtro conforme o print. Ações/seleção não são ordenáveis nem recebem filtro textual sem significado.
- Filtro textual abre popover com input “Filtrar [coluna]”. Para datas, números, estados e usuários, usar controle apropriado: intervalo, faixa ou opções. Não aplicar `ILIKE` em datas/números.
- Ciclo sem ordenação → crescente → decrescente → sem ordenação; preservar ordenação operacional inicial quando existir. `aria-sort`, foco e nome acessível em todos os botões.
- Filtros de colunas combinam entre si por AND e com a busca global. Busca em Nome inclui o nome compartilhado; Meu apelido tem filtro próprio privado. E-mail/telefone pesquisam todos os canais, mesmo que a célula mostre o principal.
- Coluna filtrada mostra estado ativo; botão global Limpar filtros (N). Ocultar coluna não pode esconder um filtro ativo sem indicação: manter chip com seu nome e opção de limpar.
- Paginação, busca, ordenação e filtros aplicados no servidor para dados grandes, antes de `LIMIT/OFFSET`, com total confiável. Ordenação estável por campo + ID; whitelist de campos e validação Zod, nunca SQL montado com identificador livre do cliente.
- Debounce 300–500 ms, manutenção dos resultados durante atualização e cancelamento de buscas antigas. Qualquer mudança de filtro/ordenação/tamanho retorna à página 1.

### 6.2 Colunas e paginação

Botão Colunas acima da tabela. Diálogo conforme print: visibilidade por checkbox, ordem por setas, registros por página, Restaurar padrão, Cancelar e Aplicar. Alterações persistem apenas em Aplicar, por usuário e `listKey`, sem misturar telas/contextos de acesso. Pelo menos uma identificação deve permanecer visível.

Padrão de 10 registros, opções 10/20/30/50/100, intervalo “1–10 de 22”, “Página 1 de 3”, anterior/próxima desabilitados nos limites e repetição inferior em listas longas. Remover último registro ajusta página inválida. Filtros relevantes ficam na URL; preferências de colunas permanecem privadas.

Mobile mantém busca, ações principais e acesso aos filtros/Colunas; pode usar cards ou rolagem horizontal explícita, com controles equivalentes. Cabeçalho sticky e rolagem controlada no desktop. Estados loading, atualização, vazio, sem resultados, erro e sem permissão obrigatórios, em ambos os temas.

### 6.3 Inventário da implementação

| Área                  | Listagens a adaptar                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operação              | Contatos, conversas/e-mails de caixas/pastas/filas/etiquetas/busca, histórico de contato, envios/rascunhos/agendados/falhas, listagem de conversas de chat. |
| Configurações         | Usuários, caixas, assinaturas, etiquetas, minhas regras/regras da caixa, auditoria e quaisquer novas listagens.                                             |
| Dashboard             | Tabelas de usuários/caixas e detalhes/rankings que listem registros.                                                                                        |
| Superadmin            | Tenâncias, usuários, caixas, consumo, divergências de armazenamento, auditoria/logs, saúde/jobs e listagens de detalhes existentes.                         |
| Empresas do diretório | Remover a listagem, sem adaptá-la ao novo padrão.                                                                                                           |

Inventariar também painéis de seleção/listagens embutidas antes de fechar a fase; justificar apresentação compacta quando aplicável. Menus de navegação, autocomplete e corpo cronológico de uma conversa não são tabelas de registros: preservam interação própria, sem inserir filtros de coluna no texto de uma mensagem. Listagens de e-mails seguem o padrão pedido mesmo preservando seleção da conversa e painel de leitura.

## 7. Etiquetas por caixa e escopo

### 7.1 Catálogo, menu e permissões

Globais sempre no topo; pessoais abaixo. Ordenar por nome dentro de cada grupo e desempatar por ID. Mesma separação na configuração, aplicação, navegação e seletores de regra. Nomes iguais em grupos diferentes continuam identificados. Busca não deve intercalar escopos.

Adicionar disponibilidade: Todas as caixas elegíveis ou Caixas selecionadas, com checkbox por caixa. “Todas” é uma política explícita que abrange novas caixas elegíveis; seleção específica não inclui futuras caixas automaticamente. Padrão de migração: Todas, preservando o comportamento anterior.

- Pessoal: dono seleciona suas caixas autorizadas; sem acesso a caixas de terceiros. Perder acesso impede aplicar/usar a etiqueta naquela caixa, sem conceder acesso pelo vínculo.
- Global: proprietário/admin seleciona caixas da tenância. Usuários comuns veem/aplicam somente no contexto de caixas permitidas e elegíveis. Supervisor pode usar globais e gerenciar regras da caixa se autorizado; não recebe gestão do catálogo global automaticamente.
- Nenhuma caixa selecionada é inválida no modo selecionado. Etiqueta pessoal em modo Todas pode existir antes da primeira caixa, sem aplicações/menu operacional.
- Relações etiqueta–caixa têm chaves compostas por tenância; payload com caixa alheia ou não autorizada é recusado. Leituras não revelam nomes/IDs/contagens de caixas inacessíveis.

### 7.2 Aplicação, menu e contadores

Menu de cada caixa exibe apenas etiquetas válidas para ela. Clique fixa `mailbox_id` junto de `label_id`; nunca abre conversas de outra caixa só porque usam a mesma etiqueta. Contador no menu é **daquela caixa**, filtrado também pelas pastas permitidas. Configuração pode mostrar total autorizado agregado com rótulo explícito, sem reutilizar esse total no menu.

API, filtros, ação em lote, detalhes e worker verificam elegibilidade. Uma global continua compartilhada na conversa; pessoal continua privada. Operações globais permanecem deltas explícitos/idempotentes, preservando aplicações pessoais e concorrência.

Retirar uma caixa da disponibilidade exige aviso sobre aplicações/regras afetadas. Proposta: aplicações anteriores ficam retidas, deixam de ser exibidas/selecionadas nesse contexto e voltam se a caixa for autorizada novamente; não excluir vínculos silenciosamente. Regras com destino agora inválido ficam pendentes/inativas até correção, e worker não aplica etiqueta fora da disponibilidade. Todas essas mudanças devem invalidar caches/contadores corretamente.

## 8. Regras pessoais e da caixa

| Regra           | Gestão                                                                | Etiquetas elegíveis                                           |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Minhas regras   | Próprio usuário, dentro das permissões da caixa                       | Apenas pessoais do próprio usuário, válidas na caixa da regra |
| Regras da caixa | Proprietário/admin; supervisor com capacidade Regras e acesso à caixa | Apenas globais da tenância, válidas na caixa da regra         |

Adicionar `add_label` ao schema de ações de caixa — hoje essa ação existe somente no schema pessoal. Não basta mudar o dropdown: validar escopo, proprietário, caixa e permissões na API e revalidar no worker na execução/reprocessamento. Aplicação global por regra registra regra e autor responsável, com vínculo único por conversa/etiqueta.

Regras pessoais existentes com ação global não podem continuar aplicando-a. Proposta de migração: preservar payload/ID/histórico, desativar a regra afetada e marcar “Revisar etiqueta: agora somente pessoais”, sem remover ação silenciosamente. Aplicações históricas permanecem. Demais regras continuam ativas. Etiqueta excluída/fora da caixa ou permissão revogada não produz aplicação indevida e recebe tratamento explícito, sem derrubar sincronização.

Manter ações atuais de mover, sinalizar, atribuir, excluir de fila, encaminhar e fixar, respeitando os escopos existentes. Remover apenas a permissão indevida de etiqueta global em regra pessoal; não converter etiquetas pessoais em globais automaticamente.

## 9. Dados, migração e armazenamento

### 9.1 Modelo proposto

| Estrutura                    | Alteração                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Configuração da tenância     | Modo obrigatório para novos contatos, sem conversão retroativa.                                                             |
| `contacts`                   | Escopo/proprietário, empresa em texto, campos Outlook aprovados, último editor, datas/versão; preservar criador atual e ID. |
| `contact_emails` e telefones | Canais/tipos/principal preservados; revisar unicidade conforme decisão sobre agendas privadas.                              |
| `contact_user_nicknames`     | Preservar, com acesso limitado ao contato autorizado e ao próprio apelido.                                                  |
| Endereços do contato         | Múltiplos e opcionais; dados do contato, sem entidades empresa/endereço independentes.                                      |
| `personal_labels`            | Manter nomes físicos/IDs, escopos e RGB; acrescentar política de disponibilidade por caixa.                                 |
| Relação etiqueta–caixa       | Nova relação por tenância/etiqueta/caixa com integridade composta e autorização.                                            |
| `mail_rules`                 | Compatibilidade com etiqueta global em regra de caixa, pendência de revisão e validação de elegibilidade.                   |
| Importações                  | Execução/itens/relatório privados, progresso/idempotência e expiração da prévia.                                            |
| Dados de teste retirados     | Descartar cadastros/vínculos de empresas e dados sem equivalente ativo; sem criar arquivo ou tabela de preservação.         |

### 9.2 Sequência segura

1. Confirmar os pontos da seção 2; levantar contagens e referências do estado implantado, sem presumir que a versão local esteja publicada.
2. Criar a próxima migration disponível; nunca editar `0022` nem outras migrations já aplicadas. Adicionar campos/políticas, preencher empresa principal no contato e preservar IDs/canais/apelidos.
3. Registros mantidos conservam seu escopo; os atuais, ainda sem escopo explícito, representam o modo global hoje implementado. Recuperar último editor somente com evidência. Não converter individuais ao trocar o modo no futuro. Ajustar autoria/FKs para usuários removidos.
4. Dados atuais são testes e não exigem preservação, conforme autorização expressa. Preencher Empresa com a principal quando viável; descartar empresas adicionais, CNPJ e endereços antigos, sem arquivo de legado ou empresas fictícias. Campos novos de endereço começam vazios nos contatos mantidos. Remover snapshots obsoletos desse diretório quando perderem utilidade, com atualização da medição. Esta etapa trata os dados retirados pela mudança do diretório; não prevê reset geral do banco ou dos e-mails.
5. Remover relações e tabelas ativas do diretório de empresas, incluindo `contact_company_links`, `contact_companies`, estruturas de visibilidade/vínculos obsoletas e dependências correspondentes. Atualizar views, triggers, catálogo de consumo e tipos antes de `DROP`; sem `CASCADE` indiscriminado.
6. Remover rota/menu Empresas, categoria Empresa da busca operacional, APIs, componentes, consultas CNPJ e referências ativas. URLs antigas devem orientar para Contatos; não oferecer formulário oculto ainda funcional. Gestão das tenâncias e superadmin permanece.
7. Criar vínculo/política de caixas de etiquetas; antigas recebem Todas. Desativar para revisão somente regras incompatíveis. Não alterar aplicações antigas, filas ou conteúdo de e-mails.
8. Atualizar projeções/medições: contatos, vínculos de etiqueta, importações e auditoria contam uma vez por registro físico; dados de teste descartados saem do consumo. Metadados privados entram no total da tenância, sem conteúdo nos relatórios do superadmin. Não atribuir agenda individual a uma caixa.
9. Ensaio em banco exclusivo de QA com registros de teste, cota cheia e usuários desativados. Backfill não pode ser impedido por limite já cheio; operações novas continuam sujeitas à cota. Não alterar limites/checkpoints de sincronização.
10. Documentar publicação conjunta de migration/API/web/worker e pausa de versões anteriores durante retirada das tabelas. O descarte de dados do diretório é autorizado e não exige arquivo de preservação. Recuperação de versão incompatível depende de backup operacional, caso disponível; não será simulado downgrade reconstruindo empresas já descartadas. Reconciliação confere redução real do consumo.

Unicidade de e-mail deve ser garantida no banco/transação, inclusive concorrência. Se permitir duplicidade por usuário, remover o índice antigo único por tenância somente após criar a nova integridade: por agenda global ou proprietário individual. Não retornar conflito por contato individual alheio que revele sua existência. Verificação de nome global também deve seguir a política confirmada, inclusive concorrência.

## 10. Plano de execução

| Fase | Entrega                                         | Critério de conclusão                                                                                        |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0    | Decisões finais e inventário de listagens/dados | Regras sem ambiguidade; matriz de telas e contratos identificada.                                            |
| 1    | Contratos e persistência                        | Escopos, autoria, empresa/cargo em texto, Outlook, etiquetas por caixa e migration ensaiada.                 |
| 2    | Padrão de listagens                             | Filtros por coluna, sort, colunas/paginação e APIs equivalentes; adaptar todas as áreas do inventário.       |
| 3    | Contatos e retirada de empresas                 | CRUD/autocomplete/buscas/formulário/autoria; sem tabelas/telas de empresas do diretório ativas.              |
| 4    | Importação                                      | CSV/VCF, mapeamento/prévia, duplicados, consumo, lotes/idempotência e relatório.                             |
| 5    | Etiquetas e regras                              | Globais primeiro, disponibilidade/menu/contagens por caixa e regras com escopos separados na API/web/worker. |
| 6    | Regressão e documentação                        | Segurança/consumo/importação/listagens, revisão visual e instruções de publicação aprovadas.                 |

Preservar React/Vite/TanStack Router/Query, Fastify/Kysely/Postgres e worker já adotados. Aplicar AGENTS.md de tokens, Lucide, formulário validado, acessibilidade e responsividade. Nenhuma troca de stack ou reinicialização de componentes base.

## 11. Critérios de aceite

- Dois usuários e duas tenâncias: global editável por membros; individual só pelo dono; nenhum vazamento por autocomplete, busca, histórico, conflito de e-mail, auditoria, cache ou evento.
- Modo obrigatório do admin aplicado em formulário, remetente e importação, sem escolha por contato. Mudança de Individual para Global e de Global para Individual afeta somente novos cadastros; aviso destacado e antigos com mesma visibilidade. Apelido não altera autoria compartilhada.
- Empresa/Cargo: acentos, caixa, espaços, caracteres de wildcard, equivalência normalizada, valores privados, novo texto e salvamento concorrente. Sem fundir nomes distintos por correspondência parcial.
- Autoria/data/hora corretas em criação, atualização e importação; conflito de edição tratado; registros antigos sem autoria completa não recebem dados inventados.
- CSV com cabeçalhos PT/EN, UTF-8/BOM, delimitadores, multiline/aspas, campos vazios, zeros iniciais, vários canais e caracteres acentuados. VCF 3/4, múltiplos cartões, dobramento/escapes, tipos/preferências e erros por cartão.
- Importação não cria duplicados em nova tentativa, não substitui dados por vazios automaticamente e não altera contatos privados alheios. Cancelamento, quota, falha de lote e retomada têm relatório consistente.
- Empresa vira texto, tabelas/telas do diretório deixam de existir e dados de teste sem equivalente são descartados, sem arquivo de legado. Endereços novos são múltiplos/opcionais no contato. Referências de busca/regras/armazenamento não quebram; tenâncias seguem no superadmin.
- Cada listagem possui filtros/ordenação/Colunas/paginação funcionando em conjunto, total correto, URL quando aplicável, preferências privadas, retorno à página 1 e ajuste de página após exclusão.
- Etiquetas globais no topo em todas as superfícies; uma etiqueta em duas caixas nunca mistura conversas nem contadores no menu de uma delas. Revogação de caixa/pasta não vaza dados.
- Regra pessoal rejeita global; regra da caixa rejeita pessoal; supervisor sem capacidade Regras não configura regra da caixa. Worker revalida caixa, escopo e autorização em novas mensagens e reprocessamento.
- Migração com cota cheia, consumo dos dados descartados retirado das projeções, importações temporárias medidas/limpas e novas operações bloqueadas corretamente quando não houver capacidade.
- Desktop/tablet/mobile em 1440/900/390/320 px, dois temas, teclado, toque, roda do mouse, leitor de tela/axe e redução de movimento. Lint, tipos, testes pertinentes e build.

## 12. Documentação e fontes de formato

Ao implementar, atualizar README, CONTATOS-BUSCA-GLOBAL.md, SPEC-EVOLUCAO-APMAIL.md, PROGRESSO.md, DEPLOY.md e documentação de consumo/operação conforme afetada. Registrar a nova regra de listagens no padrão compartilhado do repositório. Não marcar este plano como entregue antes da validação.

Referências consultadas para o formato; mapeamentos e políticas de escopo/duplicados acima são decisões de projeto do APMail:

- [Microsoft — importar/exportar contatos CSV](https://support.microsoft.com/en-us/outlook/people/import-or-export-contacts-in-outlook-using-a-csv-file): fluxo CSV e recomendação de UTF-8.
- [Microsoft — importar planilha no Outlook clássico](https://support.microsoft.com/en-us/outlook/import-contacts-from-an-excel-spreadsheet-to-classic-outlook): mapeamento de colunas e limitações de separador.
- [RFC 6350 — vCard 4.0](https://www.rfc-editor.org/rfc/rfc6350.html) e [RFC 2426 — vCard 3.0](https://www.rfc-editor.org/rfc/rfc2426.html): propriedades, múltiplos canais, escapes e linhas dobradas.
