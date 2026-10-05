# Armazenamento e dashboard do superadmin — plano de ação

Data: 05/10/2026. Status: **implementado no workspace; publicação a cargo do usuário**. Fases 0–6 entregues. Evidências e operação em [OPERACAO-ARMAZENAMENTO.md](OPERACAO-ARMAZENAMENTO.md) e [PROGRESSO.md](PROGRESSO.md). Nenhum commit, push ou deploy realizado nesta execução.

Objetivo: tornar o consumo de cada tenância e caixa verificável e oferecer uma visão organizada da plataforma ao superadmin. Nesta etapa não haverá planos comerciais, preços, cotas por cliente, bloqueios por consumo ou atribuição de plano.

## 1. Base atual e resultado esperado

O projeto usa PostgreSQL 17 compartilhado, volume persistente de arquivos, Fastify, worker/BullMQ e React/TanStack Router. Preservar essa arquitetura. As rotas de mensagens/anexos continuam verificando tenância, caixa e pasta; o superadmin permanece sem acesso operacional.

Hoje os anexos estão em `attachments/{tenant}/{mailbox}/{message}/{file}`; uploads em `uploads/{tenant}/{user}/{file}`; assinaturas e avatares têm vínculo cadastral. O painel soma corpos de mensagens/rascunhos e tamanhos registrados de arquivos. Falta confrontar registros com disco, ampliar as categorias medidas, acompanhar histórico e medir infraestrutura.

Resultado esperado: selecionar uma empresa, consultar suas caixas e compreender quanto é conteúdo, arquivo presente, compartilhamento, retenção e divergência. Na visão geral, compreender crescimento, capacidade disponível, saúde e pontos de atenção, sem abrir conteúdo de clientes.

## 2. Contrato de medição: o significado de cada número

Não apresentar um único número ambíguo de “armazenamento real”. As seguintes medidas terão nomes, fonte, unidade e instante/intervalo de coleta explícitos:

| Medida                       | Fonte e precisão                                                                                                               | Atribuição                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Dados lógicos registrados    | Bytes segundo uma fórmula versionada sobre campos persistidos; mensuração reproduzível, não espaço físico das páginas do banco | Caixa, tenância ou plataforma, conforme a origem                                           |
| Arquivos presentes           | Tamanho em bytes conferido no sistema de arquivos, contando cada arquivo físico uma vez                                        | Caixa ou tenância; arquivos sem origem ficam identificados separadamente                   |
| Espaço alocado para arquivos | Blocos alocados informados pelo sistema de arquivos, com suporte/unidade verificados no ambiente                               | Caixa/tenância quando a propriedade física é inequívoca; sem suporte, mostrar indisponível |
| Banco físico                 | Tamanho do banco e de tabelas/índices/TOAST; WAL separado                                                                      | Plataforma, porque o banco atual é compartilhado                                           |
| Infraestrutura               | Capacidade dos volumes, backups, logs físicos, persistência Redis e outros componentes coletados                               | Plataforma; nunca rateio silencioso entre clientes                                         |

O Node expõe tamanho do arquivo e quantidade de blocos alocados como medidas diferentes; usar `lstat`/`statfs` e validar o comportamento do filesystem de produção. Compressão, arquivos esparsos e compartilhamento de blocos precisam de tratamento explícito. [Referência Node 22](https://nodejs.org/docs/latest-v22.x/api/fs.html#class-fsstats).

As funções de tamanho do PostgreSQL medem objetos do banco; `pg_total_relation_size` inclui índices/TOAST. **Não existe nesta arquitetura uma medição exata de páginas físicas por `tenant_id`**. Essa é uma conclusão de arquitetura: linhas de várias empresas ocupam relações compartilhadas. O plano mede dados lógicos por cliente e banco físico global, sem chamar um rateio de consumo exato. [Referência PostgreSQL 17](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE).

### Fórmulas e invariantes

- `dados_da_caixa = conteúdo lógico persistido da caixa + tamanho dos arquivos presentes atribuídos exclusivamente à caixa`.
- `dados_da_tenância = soma dos dados das caixas + conteúdo lógico e arquivos compartilhados da tenância`.
- Essas duas somas serão rotuladas **Dados atribuídos**, nunca “espaço físico total no servidor”. Arquivos alocados terão coluna própria; não somar conteúdo lógico ao tamanho físico do PostgreSQL.
- A soma dos arquivos de caixas, compartilhados das empresas, compartilhados da plataforma e não atribuídos deve explicar o inventário de arquivos presentes. Diferenças de capacidade do volume incluem metadados do filesystem e, quando aplicável, outros projetos no mesmo disco.
- Estado de retenção é uma subdivisão: ativo + excluído ainda retido = total; não somar “retido” novamente ao total.
- Memória RAM, tamanho original MIME e consumo do provedor IMAP têm rótulos próprios e não entram no total local. O histórico importado pode representar apenas parte da caixa do provedor.
- Números persistidos em `bigint`, cálculos sem arredondamento e bytes como unidade de base. API envia inteiros grandes como strings decimais; UI formata B/KiB/MiB/GiB e oferece bytes exatos no detalhe/exportação.

### Conteúdo lógico e cobertura

Manter o indicador atual de corpos HTML/texto para comparação e ampliar a cobertura com categorias separadas: cabeçalhos/metadados de mensagens, rascunhos/outbox, notas, contatos, regras, assinaturas, chat e auditoria vinculada à empresa. Fazer inventário de tabelas/colunas no início da implementação. Identidade global, sessões, métricas e auditoria global ficam na plataforma.

Definir por tabela os campos contados, sua representação e proprietário. Texto usa UTF-8; estruturas usam representação canônica versionada. Campos persistidos em duas linhas contam duas vezes, porque são duas cópias registradas. Não usar soma genérica de `pg_column_size` como se incluísse todo o custo físico da linha. Categorias, versão e cobertura incompleta ficam visíveis.

## 3. Propriedade dos arquivos e ciclo de vida

| Origem                                                  | Regra de propriedade e contagem                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Anexo recebido/enviado ou imagem CID da mensagem        | Caixa e tenância da mensagem; cada cópia física efetivamente criada conta                      |
| Upload sem vínculo com rascunho                         | Compartilhado da tenância, com usuário de origem; não atribuir a uma caixa arbitrária          |
| Upload referenciado apenas por rascunhos de uma caixa   | Pode ser atribuído à caixa; referência e transição devem ser rastreadas                        |
| Arquivo referenciado por várias caixas da mesma empresa | Compartilhado da tenância, contado uma vez; referências não multiplicam seu tamanho            |
| Imagem/texto de assinatura                              | Compartilhado da tenância; cópias incorporadas a mensagens pertencem às respectivas caixas     |
| Avatar de identidade global                             | Plataforma; não duplicar por empresa nem escolher arbitrariamente uma tenância                 |
| Arquivo excluído logicamente mas ainda presente         | Continua consumindo e aparece como retido no proprietário conhecido                            |
| Temporário ou órfão                                     | Categoria própria; atribuir somente quando origem for comprovada, caso contrário não atribuído |
| Registro cujo arquivo não existe                        | Divergência; não inventar bytes presentes a partir do tamanho cadastral                        |

Criar cadastro central de arquivos, preservando as tabelas de domínio. Cada item terá identificador, chave interna, proprietário, categoria, tamanho esperado, tamanho observado, alocação observada, identidade física quando disponível, estado, datas e versão. Referências ficarão separadas para distinguir reutilização de cópia física.

Novos caminhos seguirão escopo explícito: anexos por empresa/caixa/mensagem; uploads por empresa/usuário; assinaturas privadas por empresa/usuário. Identidade do avatar permanece global. A organização de diretórios ajuda a inspeção, mas não substitui permissões.

Gravação: registrar intenção, escrever em temporário, fechar arquivo, renomear, conferir tamanho e confirmar cadastro. Remoção física só reduz uso após confirmação; falha mantém o item como pendente. Operações repetidas, retentativas, envio, encaminhamento, falha de transação e queda de processo precisam ser idempotentes e reconciliáveis.

Contar caminhos/identidades físicos sem duplicação. Hard links encontrados não são autorização nem uma forma de compartilhar entre clientes: detectar, deduplicar a medida física e sinalizar vínculos incompatíveis. Reflinks/compressão sem medição confiável recebem qualificação; não prometer alocação exclusiva exata.

## 4. Reconciliação e atualização

Atualizações normais virão das operações de escrita/remoção, sem varrer o disco a cada abertura do dashboard. A reconciliação verifica a realidade do volume e recupera perdas de eventos ou inconsistências.

| Processo                                | Cadência inicial proposta                | Comportamento                                                          |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Registro de alterações                  | A cada operação                          | Atualização idempotente com referência ao arquivo/operação             |
| Consolidação de dados atribuídos        | Até 60 segundos após eventos processados | Cache/agregados por empresa/caixa; mostrar atraso quando excedido      |
| Conferência de arquivos novos/alterados | A cada 15 minutos                        | Lotes limitados, sem disputar concorrência de IMAP/SMTP                |
| Inventário completo                     | Diário, fora da janela de backup         | Varredura em streaming, checkpoint e retomada                          |
| Recursos e saúde                        | A cada 60 segundos                       | Dados leves, com fonte e validade                                      |
| Histórico                               | Horário por 90 dias; diário por 24 meses | Retenção configurável; sem inventar dados anteriores à primeira coleta |

Fila própria de medição, uma varredura por volume por vez, lock com renovação, deduplicação de solicitações e limites configuráveis de I/O/lote/duração. Agendamentos devem considerar o backup atual das 03h. O botão **Atualizar medição** enfileira trabalho, retorna acompanhamento e não bloqueia a requisição por uma varredura.

Scans usam caminhos controlados, não seguem links simbólicos, não leem corpos/anexos e nunca aceitam um caminho arbitrário vindo do browser. Escritas em curso e temporários recentes têm janela de tolerância. Revalidar arquivos alterados durante coleta; mostrar início/fim, pendências e cobertura em vez de alegar snapshot atômico de um disco ativo.

Publicar somente um conjunto coerente de totais/páginas por execução/revisão. Um scan parcial ou interrompido não zera valores anteriores; mantém a última medição válida e sinaliza atraso/falha. Incrementos posteriores ao corte da coleta não podem ser sobrescritos por resultados antigos.

Divergências: arquivo ausente, tamanho divergente, arquivo sem referência, temporário antigo, vínculo incompatível, erro de leitura e coleta incompleta. Oferecer consulta e reconciliação auditada. **Esta etapa não inclui apagar/quarentenar automaticamente arquivos, nem novas políticas de expurgo.** Limpezas já existentes devem integrar o cadastro e conservar suas regras.

## 5. Infraestrutura e segurança

- Medir banco físico via funções SQL permitidas e listas fixas de relações; separar dados/índices/TOAST sem somar objetos já incluídos em um total. WAL e diretórios de dados usam coletor autorizado de metadados quando necessário.
- Medir volume de arquivos e backups reais. Registrar tamanho, data, resultado e checksum/validação já existentes do backup; não acessar seu conteúdo ou segredos. “Backup concluído” e “restauração testada” são estados distintos.
- Identificar volumes/dispositivos: dois mounts sobre o mesmo filesystem não são duas capacidades independentes. Capacidade livre é a do filesystem; uso de outro projeto no host não pertence ao APMail.
- CPU/RAM por serviço somente por coletor/cgroup que consiga observar aquele serviço. Métrica de container não deve ser rotulada host. Coletar banco/Redis/worker por adaptadores próprios; fonte inacessível aparece como indisponível, nunca zero.
- Coletores novos têm acesso mínimo e de leitura aos diretórios/estatísticas necessários, credenciais próprias e envio autenticado de métricas. Não montar socket Docker ou usar container privilegiado para o dashboard. Coleta do host, se necessária, usa serviço dedicado e escopo explícito; ambiente atual será inventariado antes da configuração.
- Todas as APIs de plataforma usam `requireSuperAdmin`. IDs de caixa precisam pertencer à empresa selecionada, inclusive em histórico, exportações e jobs. Métricas globais nunca ampliam o acesso operacional.
- Browser recebe nomes cadastrais de empresa/caixa, contagens, bytes e estados; não recebe assuntos, corpos, nomes de anexos, conteúdo de chat, credenciais, caminhos físicos ou conteúdo dos backups. Logs expostos serão sanitizados.
- Novas imagens de assinatura passam a ser privadas, com prévia autenticada e envio CID. URLs públicas antigas ficam explicitamente marcadas como legado e restritas aos IDs anteriores, para não quebrar mensagens já enviadas. Desativar definitivamente o legado público será decisão separada, não remoção silenciosa.
- Mudanças de papel, reconciliações e exportações de uso são auditadas. Tokens/segredos não aparecem em eventos, histórico ou relatórios.

## 6. Dashboard do superadmin

O `/superadmin` terá **Visão geral** como entrada, com indicadores globais de plataforma. O gerenciamento de usuários/caixas continua exigindo primeiro a seleção da tenância. Rankings e gráficos globais mostram somente metadados/consumo; detalhar uma linha seleciona sua empresa e mantém esse contexto na URL.

### Organização da visão geral

| Bloco                       | Informações e ações                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cabeçalho e filtros         | Período, fonte/instante da medição, estado da coleta, atualizar, exportar; filtros avançados sob demanda                                  |
| Resumo operacional          | Tenâncias ativas/suspensas, caixas por estado, usuários empresariais únicos, superadmins separados, convites pendentes e mensagens locais |
| Resumo de armazenamento     | Dados atribuídos, arquivos presentes/alocados, compartilhado, retido, não atribuído e espaço livre; banco físico separado                 |
| Evolução                    | Crescimento por hora/dia, entradas/remoções registradas, variação líquida, composição por categoria e período                             |
| Rankings                    | Empresas/caixas com maior uso e crescimento; detalhes paginados e contexto selecionável                                                   |
| Saúde                       | API, PostgreSQL, Redis, workers, heartbeat, sincronizações atrasadas, filas por estado/idade e falhas de envio/convite                    |
| Capacidade e infraestrutura | Uso dos volumes, banco/índices/WAL, backups/logs/Redis, CPU/RAM por fonte; recursos indisponíveis identificados                           |
| Integridade                 | Coleta atrasada, divergências, arquivos ausentes/órfãos, pendências de exclusão e última reconciliação                                    |
| Atividade administrativa    | Criação/suspensão de empresas, mudanças de acesso, exportações e reconciliações; sem conteúdo de clientes                                 |

Percentuais de disco referem-se à capacidade observada da infraestrutura. Alertas iniciais de capacidade em 80%/90%, heartbeat ausente, falhas e atraso de medição são parâmetros operacionais configuráveis, não cotas ou planos por cliente. Sem bloqueio automático de clientes.

Projeção de capacidade é estimativa claramente rotulada, exibida apenas quando houver histórico suficiente; crescimento nulo/negativo e histórico insuficiente não geram prazo fictício. Usuários globais e usuários presentes em várias empresas não são multiplicados na contagem global de identidades.

### Visão da empresa selecionada

Cards com dados atribuídos, arquivos presentes/alocados, compartilhado, retido, quantidade de mensagens/arquivos, crescimento e última conferência. Gráficos de evolução e composição; listagem de caixas com status, consumo por categoria, retenção, crescimento, última sincronização e qualidade da medição. A soma de caixas + compartilhado explica o total da empresa.

### Visão da caixa selecionada

Resumo de dados lógicos, anexos/imagens presentes, blocos alocados disponíveis, rascunhos/uploads atribuídos, ativos/retidos, quantidades, crescimento e divergências. Mostrar cobertura da importação quando conhecida; não confundir volume local com quota/ocupação no provedor IMAP. Nenhuma ação de abrir mensagem ou baixar anexo.

### Interação e apresentação

Reutilizar componentes e tokens existentes, Inter, temas claro/escuro, gráficos com legenda e alternativa em tabela, números/datas alinhados e um `h1` por página. Em desktop: cards, gráficos em duas colunas e tabela; em tablet: composição reduzida; em celular: cards e blocos por prioridade, ações em menu, filtros recolhíveis. Saúde/capacidade/qualidade aparecem antes das tabelas longas.

Listagens seguem `ConfigurableTable`/contrato equivalente no servidor: 10 itens iniciais, opções 10/20/30/50/100, busca, filtros, ordenação por whitelist, colunas por usuário/listKey, paginação e total confiável. URL e cache incluem período/empresa/caixa. Troca de contexto não exibe dados da empresa anterior. Estados carregando, atualizando, vazio, erro, atrasado e sem permissão fazem parte da entrega. CSV usa os mesmos filtros e instante de medição, bytes exatos, UTF-8 e proteção contra fórmulas em células.

## 7. Modelo técnico e entregas por fase

Nomes abaixo são propostas para a implementação, não tabelas/rotas já existentes.

| Fase                           | Entrega                                                                                                                               | Critério para avançar                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0. Inventário e contrato       | Mapear tabelas/categorias, volumes/mounts, versões, retenção e fontes de métricas; fixar fórmulas/atribuição e limites de coleta      | Catálogo de cobertura completo e nenhum número apresentado com precisão maior que a fonte                           |
| 1. Cadastro e migração inicial | `storage_assets`, `storage_asset_refs`, operações pendentes e constraints por escopo; preenchimento por lotes dos arquivos existentes | Rodar duas vezes não duplica; IDs/links atuais permanecem; nenhum arquivo movido/apagado pelo preenchimento inicial |
| 2. Ciclo de vida               | Integrar ingestão, uploads, envio/CID, cópias, assinaturas, avatares e limpezas existentes; contabilização e propriedade consistentes | Retentativa, rollback e queda entre escrita/banco deixam estado recuperável, sem dupla contagem                     |
| 3. Conferência e histórico     | `storage_scan_runs`, divergências, agregados e snapshots; inventário completo/incremental, agendamento, acompanhamento                | Contagens conferem com fixtures e disco; interrupção/concorrência não publica total inválido                        |
| 4. Infraestrutura e APIs       | Adaptadores de banco/volumes/backups/recursos, métricas de filas e API protegida para resumo/histórico/listas/exportação              | Fontes comprovadas, medição indisponível explícita, segurança e isolamento aprovados                                |
| 5. Dashboard e detalhamento    | Visão geral, empresa, caixa, gráficos, alertas operacionais e exportação                                                              | Somatórios explicáveis, contexto preservado, responsividade e teclado aprovados                                     |
| 6. Homologação e entrega       | Migração ensaiada, validação de carga/privacidade, documentação de operação e recuperação                                             | Checks e critérios de aceite abaixo aprovados; entrega local pronta para o usuário publicar                         |

Dependências: 0 → 1 → 2 → 3 → 4 → 5 → 6. Protótipos de layout podem ser preparados depois do contrato; consolidação visual usa dados reais homologados. A publicação deve juntar os componentes compatíveis e não expor um dashboard parcial como medição concluída.

### Modelo e fronteiras

- `storage_assets`: proprietário único (`mailbox`, `tenant`, `platform`, `unassigned`), IDs, categoria, chave interna única por backend/volume, tamanho esperado/observado, alocação opcional, estado e revisão. Check/FK impedem caixa de outra empresa; arquivo ausente tem bytes presentes nulos/zero conforme estado, mantendo esperado separado.
- `storage_asset_refs`: origem tipada, entidade e vínculo único; referência não é uma segunda cópia. Conflito entre tenâncias é incidente, nunca compartilhamento autorizado.
- `storage_operations`: intenção/resultado de escrita, cópia e exclusão; retries com identidade estável. Transações e eventos após commit precisam evitar alteração perdida ou reprocessada.
- `storage_scan_runs` e `storage_discrepancies`: início/fim, revisão/cursor, resultado, quantidade/bytes verificados, pendências e erro sanitizado. Controle de progresso sem expor caminhos.
- `storage_usage_snapshots` e `platform_metric_samples`: hora UTC, escopo, categorias, contagens, fonte/cobertura, versão da fórmula e validade. Índices de escopo/data; retenção/compactação não apagam o último estado válido. Não misturar séries de fórmulas incompatíveis sem marca de mudança.
- API: resumo global, resumo por empresa/caixa, série temporal, integridade, estado da coleta e exportação; novo job de reconciliação retorna 202 e ID. Consultas Zod, paginação/ordenação no servidor, rate limit de jobs, cache com contexto e leitura por execução coerente.
- Compatibilidade: manter o campo/endpoint atual durante transição ou versionar explicitamente; nunca reutilizar silenciosamente `total_bytes` com uma fórmula diferente. Interfaces/API novas informam definição, fonte, qualidade, versão, intervalo de coleta e atraso.

## 8. Critérios de aceite e testes

- [x] Fixtures com duas empresas, várias caixas, arquivos conhecidos e compartilhados fecham as fórmulas em bytes; soma das caixas + compartilhado = empresa, e totais globais não multiplicam empresas/usuários/arquivos.
- [x] Texto UTF-8/acentos, JSON, HTML/texto simultâneos, arquivos vazios/grandes, campos omitidos e categorias de metadados obedecem à fórmula versionada.
- [x] Reutilização, cópia real, rascunhos de várias caixas, assinatura CID, avatar global, importação histórica e upload consumido seguem a atribuição documentada.
- [x] Arquivo ausente/divergente, órfão, temporário recente/antigo, hard link, symlink e falha de leitura produzem estados corretos; coletor não sai de suas raízes nem remove conteúdo.
- [x] Exclusão lógica não reduz arquivos presentes; exclusão física confirmada reduz; falha não finge liberação. Espaço físico do PostgreSQL pode não diminuir imediatamente após exclusão e aparece separado.
- [x] Robustez conferida com estado durável/cursor, retentativa, duas conexões concorrentes, escrita com revisão durante scan, execução repetida de estado terminal, coleta interrompida e continuação cancelada/retomada. Transações e falhas de envio mantêm estado recuperável e não substituem a última medição boa por zero.
- [x] Fontes indisponíveis, amostras antigas e varredura incompleta mostram ausência/atraso/cobertura; histórico anterior à coleta é vazio e não é reconstruído como consumo real passado.
- [x] Mesmo volume visto de dois containers não conta duas vezes; tamanho de arquivo e alocação diferem quando necessário. Capacidade compartilhada com outros projetos é identificada.
- [x] Superadmin consulta métricas/gestão sem acessar mensagens/anexos; empresa/caixa erradas, membros comuns, admin empresarial e links privados diretos são negados nas APIs novas. Legado público de assinatura não publica imagens privadas novas.
- [x] CSV, tabelas, cards e gráficos usam filtros, unidade/fórmula e data compatíveis; lista vazia, carregamento, erro, atualização e atraso têm apresentação própria.
- [x] Desktop 1440 px, tablet 900 px e celular 390 px em claro/escuro: teclado, semântica/ARIA para leitores de tela, foco, contraste AA automatizado, redução de movimento e alternativa textual dos gráficos conferidos. Não houve teste manual com software de leitor de tela.
- [x] Lint, typecheck, testes relevantes e build passam; integração real com PostgreSQL/Redis/filesystem e regressão IMAP/SMTP em QA sem acessar caixas reais de produção.
- [x] Ensaio com pelo menos 100 mil arquivos/1 milhão de registros ou volume representativo inventariado: memória/I/O limitados, scan retomável e nenhuma varredura no request; metas e duração registradas conforme recursos de QA, sem prometer desempenho antes da medição.
- [x] Preenchimento inicial reversível, backup/restauração ensaiados em ambiente isolado, última versão legada compatível e documentação de operação/migração pronta.

## 9. Entrega e limites desta etapa

A implementação adiciona migrations aditivas `0011`–`0016`, cadastro de arquivos, projeção lógica transacional, reconciliação em lotes, histórico, fontes de infraestrutura e dashboard. Não move diretórios existentes. Arquivos legados foram preservados durante a migração ensaiada; a limpeza de produção solicitada posteriormente pelo usuário é um procedimento separado, documentado no progresso.

Não haverá vínculo com plano, preço, cobrança, quota comercial, expurgo novo ou bloqueio de sincronização/envio por consumo. O módulo entrega observabilidade e integridade. Medição física exclusiva do PostgreSQL por cliente exigiria avaliar isolamento de relações/bancos; isso permanece fora deste plano, identificado como limite da arquitetura compartilhada.

Commit/push/deploy serão feitos pelo usuário. As novas migrations e imagens não foram aplicadas em produção. O novo painel e os coletores entram em funcionamento após a publicação conjunta de API/web/worker; fontes opcionais do host exigem configuração explícita no deploy.

## 10. Evidências da entrega

- Catálogo lógico reproduzível `logical-json-v1`, referências transacionais, bytes como strings decimais e publicação coerente por execução. As páginas de uma exportação mantêm a mesma transação/medição.
- Reconciliação completa diária às 04h30, incremental a cada 15 minutos e publicação/infraestrutura a cada 60 segundos; parâmetros de lote, duração, retenção e alertas configuráveis. Lock de sessão do PostgreSQL fica válido durante toda a coleta e é liberado com o término da conexão; não precisa de renovação por prazo.
- APIs exclusivas do superadmin; assinatura nova privada e CID, legado explicitamente marcado; ausência de conteúdos/caminhos/credenciais nas métricas.
- Dashboard, empresa e caixa com consumo, composição, crescimento, retenção, compartilhamento, integridade, filas, recursos e exportação. Histórico insuficiente, qualidade parcial e fontes inacessíveis são estados explícitos.
- Testes de PostgreSQL/Redis/filesystem e regressão GreenMail IMAP/SMTP; navegador 1440/900/390 px, claro/escuro, axe AA e navegação sem recargas. Leitores de tela são cobertos pela semântica/ARIA e inspeção automatizada; não houve sessão manual com NVDA/VoiceOver.
- Carga: 1 milhão de mensagens, 100 caixas e 100 mil arquivos; 43 lotes, zero divergências, 881.191 ms de reconciliação e pico de RSS de 127.979.520 bytes, com limite de um núcleo/768 MiB no processo de QA. Geração das fixtures: 903.834 ms. Metas e resultados são deste laboratório, sem promessa de duração equivalente em outros volumes.
- Backup final de produção `20261005T182009Z`: banco restaurado em ambiente independente (1 empresa, 2 usuários, 2 caixas, 748 mensagens); 253 arquivos/7.123.799 bytes restaurados e SHA-256 individual conferido; dump Redis aprovado pelo verificador. Migrations aditivas ensaiadas sobre a restauração anterior e conta superadmin aprovada com a imagem legada. Recursos de laboratório com cópias de produção foram removidos após os testes.
- Limpeza adicional de produção autorizada: somente um superadmin, zero empresas/caixas/mensagens/arquivos/vínculos; schema `0010` e configuração preservados. Login HTTPS, bloqueio operacional e SMTP global conferidos. Senha gerada fora do repositório, sem inclusão em documentação ou Git.
