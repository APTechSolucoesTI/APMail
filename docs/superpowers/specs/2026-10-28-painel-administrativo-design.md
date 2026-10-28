# APMail — Painel Administrativo, domínios e organização do e-mail

Data: 28/10/2026. Estado: desenho aprovado pelo usuário em 28/10/2026; plano técnico em `../plans/2026-10-28-painel-administrativo.md`.

## 1. Objetivo e decisões confirmadas

Separar a administração da empresa do trabalho diário com e-mails. O Painel Administrativo deve oferecer informação útil e ações claras, mantendo a identidade visual e a arquitetura do APMail.

Confirmado na conversa:

- Entrada pelo menu da foto, no canto superior direito, com “Painel Administrativo” e, abaixo, “Meu perfil”, que continua em `/settings/profile`.
- Mover Antivírus, Relatórios, Integrações, Equipe e Acesso, Empresa, Auditoria e gestão de Caixas de E-mail para o painel.
- Manter o Dashboard das caixas no ambiente de e-mail. Criar uma visão geral administrativa diferente.
- Permitir acesso delegado: quem tem permissão para uma seção pode acessar essa seção, mesmo sem papel de administrador.
- Cadastrar domínios e consultar DNS, sem comprovação de propriedade.
- Continuar conectando contas existentes por provedor. Não criar contas na hospedagem nem integrar APIs administrativas de HostGator, Locaweb ou outras nesta entrega.
- Selecionar domínio e informar a parte inicial do endereço ao conectar uma caixa.
- Oferecer preferência pessoal para agrupar caixas por domínio, sem nomes de grupo personalizados.
- A empresa controla a exibição do atendimento por filas. O cálculo interno continua funcionando quando as filas estão ocultas.
- Resumo pessoal continua exibindo as caixas de entrada quando as filas estão ocultas.
- Mensagens independentes com mesmo assunto/remetente não podem ser misturadas. Respostas mantêm a conversa; Concluir controla atendimento e não o agrupamento.
- Sem mockups. Reutilizar o padrão visual existente.

## 2. Base examinada e restrições

Repositório real: `E:\Sistemas\APMail`, branch `main`, inicialmente limpo, commit `a445089`. A pasta desta conversa é um espelho de contexto, não a aplicação. `sources/` permanece intocado.

Stack existente: monorepo pnpm, React/Vite/TanStack Router/Query, shadcn New York e Tailwind, API Fastify, PostgreSQL/Kysely e workers Redis/BullMQ. Não migrar para Supabase ou TanStack Start. Migrations estão em `packages/db/migrations`; a última examinada é `0062`.

Achados relevantes:

- `AppShell` reúne navegação, sessão, troca de empresa e eventos em tempo real. A foto hoje é um link direto ao perfil.
- `useMailQueues` ainda lê `user_preferences.mail_queues_enabled`; a preferência não é mais editável na tela. A nova política deve substituir essa leitura.
- Resumo, tabelas e controles de atendimento já consultam esse hook; Dashboard e outros pontos precisam de revisão adicional.
- `resolveThread` usa referências de mensagens e também assunto normalizado + participante em comum em 14 dias. Esse segundo caminho pode juntar mensagens independentes e também é usado para envios novos.
- Não se confirmou por reprodução que Concluir seja a causa do problema relatado. O plano deve reproduzir o caso e testar o fluxo completo antes de declarar correção.
- Integração Google é individual por usuário e empresa. Movê-la de lugar não a transforma em uma conexão compartilhada.
- Já existe `/superadmin`, reservado à plataforma. O novo painel é da empresa atual e não substitui nem amplia esse acesso.

## 3. Abordagens consideradas

1. Apenas trocar links de lugar: menor mudança, mas não entrega a visão administrativa, os domínios ou a política de filas solicitados.
2. Aplicação administrativa separada: duplica infraestrutura e integração de sessão; não atende à orientação de aproveitar o sistema atual.
3. Painel integrado, com navegação própria e recursos existentes: atende ao pedido e preserva arquitetura, permissões e sessão. É a abordagem técnica recomendada neste desenho; a aprovação do documento confirma sua adoção.

Não há motivo funcional identificado para uma aplicação independente. Usar um layout administrativo dentro da aplicação atual, compartilhando uma única instância dos provedores de sessão, cache, sockets e transferências.

## 4. Navegação e compatibilidade

Rotas canônicas propostas, decisão técnica do implementador:

| Destino                                 | Rota                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Visão geral administrativa              | `/admin`                                                                  |
| Domínios e detalhe                      | `/admin/domains`, `/admin/domains/$domainId`                              |
| Caixas e detalhe                        | `/admin/mailboxes`, `/admin/mailboxes/$mailboxId`                         |
| Equipe, perfis e permissões individuais | `/admin/users`, `/admin/access-profiles`, `/admin/user-permissions`       |
| Empresa e padrões de e-mail             | `/admin/company`                                                          |
| Integrações                             | `/admin/integrations`                                                     |
| Auditoria                               | `/admin/audit`                                                            |
| Antivírus                               | `/admin/security/antivirus`                                               |
| Relatórios e subrotas atuais            | `/admin/reports`, `/admin/reports/meet`, `/admin/reports/meet/$meetingId` |

O painel tem navegação própria, empresa atual identificada e ação “Voltar ao e-mail”. O menu da foto funciona nos dois ambientes; Sair preserva o comportamento de encerramento atual.

No e-mail permanecem Dashboard, caixas, Resumo, contatos, chat, calendário, lembretes/tarefas, envios/agendamentos e configurações pessoais: preferências, assinaturas, etiquetas e regras, sempre conforme as permissões atuais. Meu perfil continua acessível pelo menu da foto; remover sua duplicação da sidebar é uma escolha de interface deste desenho.

As rotas antigas dos módulos movidos redirecionam para as correspondentes novas, preservando parâmetros, busca e identificadores. Atualizar links internos, notificações e atalhos. Preservar a URL externa registrada do callback Google; alterar apenas seu destino interno de retorno e manter o parâmetro de resultado. Importação/exportação e transferências em andamento não devem ser desmontadas pela troca de ambiente.

## 5. Autorização e isolamento

Não adicionar uma permissão genérica que conceda administração completa. A entrada no painel aparece quando existe pelo menos uma seção permitida. Os papéis e perfis existentes continuam sendo a fonte de autorização, inclusive capacidades legadas de supervisor.

| Seção                       | Permissão                                                                |
| --------------------------- | ------------------------------------------------------------------------ |
| Caixas                      | `mailboxes.manage`                                                       |
| Empresa e política de filas | `company.manage`                                                         |
| Equipe                      | `users.view`, ações por `users.invite`/`users.manage`                    |
| Perfis                      | `profiles.manage`                                                        |
| Auditoria                   | `audit.view`, conteúdo restrito por `audit.content`                      |
| Antivírus                   | `antivirus.view`, decisões por `antivirus.release`/`antivirus.trust`     |
| Relatórios                  | `reports`, mantendo filtros pessoais e de caixas atuais                  |
| Integrações                 | `integrations`, mantendo a propriedade individual das conexões           |
| Domínios                    | novas `domains.view` e `domains.manage`; gerenciar depende de visualizar |

Permissões de domínios são incluídas nos perfis padrão de proprietário e administrador, inclusive no bootstrap de novas empresas. Não ampliar perfis personalizados ou permissões individuais automaticamente. Papéis legados recebem tratamento equivalente, sem passar a liberar as novas permissões por omissão.

A pessoa com gestão de caixas pode consultar um seletor mínimo de domínios (id e nome) para conectar uma caixa, sem receber todo o diagnóstico ou permissão de editar domínios. Agrupamento do operador deriva somente das caixas que ele já pode acessar.

Verificar rotas e endpoints novos em `screenPermission`, `routePermission`, guards e testes. Cada bloco da visão geral aplica sua própria permissão no servidor. Não retornar totais, nomes ou eventos de áreas não autorizadas para depois ocultá-los no browser. Permissão de domínios não concede acesso ao conteúdo dos e-mails.

Trocar empresa ou revogar acesso limpa dados da empresa anterior e atualiza navegação e conteúdo em tempo real. Uma pessoa com apenas relatórios ou integração pode receber uma visão geral reduzida com atalhos autorizados, sem métricas administrativas da empresa.

## 6. Visão geral administrativa

A referência Zoho inspira a concentração de pendências e situação da organização, sem copiar marca, inventar indicadores ou duplicar o Dashboard das caixas.

Blocos propostos:

- **Requer atenção:** caixas com erro/recuperação, sincronização atrasada segundo o critério existente, limite de armazenamento e problemas DNS observados. Cada item informa data da observação e leva à seção correspondente.
- **Domínios:** quantidade cadastrada, diagnósticos pendentes/desatualizados e alertas por registro; não usar “domínio verificado”.
- **Caixas conectadas:** distribuição de ativas, com erro, desativadas e arquivos locais. Arquivo local não deve ser apresentado como conexão com falha.
- **Armazenamento:** consumo e limites locais do APMail; cota do provedor em bloco separado e com cobertura parcial/indisponível quando necessário.
- **Equipe e acesso:** membros ativos, desativados e convites pendentes somente para quem pode consultar equipe.
- **Segurança:** resumo autorizado de arquivos bloqueados, aguardando análise e pendências do antivírus, usando as métricas existentes e sem expor nomes de arquivos no resumo.
- **Atividade administrativa recente:** eventos resumidos de auditoria, sem corpo de e-mail ou metadados sensíveis.
- **Padrões da empresa:** informar se as filas estão visíveis e oferecer atalho de configuração quando autorizado.

Não adicionar CPU, memória, logs globais, backups de toda a instalação, dados de outras empresas, certificações, nota de segurança arbitrária ou indicadores sem fonte real. Não criar gráfico apenas para decorar.

Usar endpoint agregado de leitura com seções opcionais por permissão, estados de atualização e falha parcial; uma falha DNS não apaga a situação de armazenamento. Atualização por eventos existentes quando disponíveis e consulta periódica moderada. Datas de observação devem diferenciar dados atuais, antigos e nunca consultados.

## 7. Cadastro de domínios e DNS

### Modelo e operações

Tabela de domínios por empresa: UUID, empresa, nome ASCII normalizado/IDNA, nome para exibição, seletor DKIM opcional, criador, datas de criação/atualização e referência ao último diagnóstico. Unicidade por empresa e nome normalizado, não global.

Diagnósticos por domínio com empresa, instante, situação por tipo e resposta normalizada limitada em tamanho. Manter a última observação; histórico ilimitado de DNS fica fora do escopo. Registrar alterações e consultas manuais na auditoria.

Adicionar vínculo de domínio às caixas, com integridade composta por empresa/domínio para impedir associação entre empresas. A migration deriva domínios dos endereços atuais e vincula as caixas sem alterar endereço, credenciais, status, mensagens ou aliases. Normalização não pode inventar domínio em registro inválido; inconsistência deve produzir diagnóstico de migração e preservar o registro para correção, sem perda de dados.

Cadastro, consulta, atualização de seletor e remoção de domínio sem caixas. Não permitir remover domínio em uso; não excluir caixas em cascata. O nome de um domínio em uso é imutável: para mudar o endereço de uma caixa, selecionar/cadastrar o domínio de destino. Não alterar endereço no provedor.

Validação de hostname no servidor: remover espaços externos e ponto terminal, normalizar caixa/IDNA, rejeitar URLs, portas, caminhos, IP literal, wildcard e nomes inválidos. Não aceitar servidor DNS ou URL de consulta arbitrária fornecida pelo usuário.

### Diagnóstico somente leitura

Consultar pelo backend usando DNS nativo, com timeout, limite de tentativas/concorrência, cache por empresa/domínio e limite de consultas manuais. Não baixar páginas do domínio, não conectar automaticamente nos hosts encontrados e não modificar DNS.

Apresentar MX com prioridade, NS, SPF observado no TXT, DMARC e DKIM quando houver seletor informado. Sem seletor, DKIM fica “Seletor não informado”, não “ausente”. Erro de resolução, timeout, inexistência de registro e ausência de consulta são estados distintos.

Mostrar valor encontrado, nome consultado, explicação compreensível e horário. Observação de um registro não comprova entrega, assinatura de mensagens ou propriedade. Ausência de MX isoladamente não é prova suficiente de impossibilidade de entrega; null MX tem significado específico. SPF com includes não pode ser declarado funcional para o SMTP da caixa apenas pela existência do texto. DMARC deve considerar herança de subdomínio quando aplicável, indicando sua origem.

O diagnóstico é consultivo e não bloqueia conexão de caixas ou uso do domínio. Não presumir MX esperado da hospedagem a partir do endereço. Não inventar registros SPF/DKIM nem sugerir substituir registros sem conhecer o provedor. Dados de registro/expiração e administração completa da zona ficam fora desta entrega.

### Fluxo de conectar caixa

Exibir “Nome da caixa”, “Parte inicial do e-mail” e “Domínio”, com prévia do endereço completo. Manter os passos e tipos IMAP/POP3/arquivo local existentes, presets e teste de conexão real. O texto deve dizer “Conectar caixa”, sem prometer criação no provedor.

Domínios existentes entram no seletor. Para conectar um endereço ainda não cadastrado, permitir adicionar o domínio no próprio fluxo, sob a permissão `mailboxes.manage`, somente com nome e sem edição avançada. A criação fica auditada e usa a mesma normalização/unicidade. Isso preserva o fluxo de Gmail/Outlook e evita exigir outra autorização para uma conexão antes permitida.

O backend deriva e valida `email_address`; não confiar em duas partes incoerentes enviadas pelo cliente. Proteger a atualização da caixa e do vínculo na mesma transação. A senha continua sendo da caixa, não de administração da hospedagem. Aliases mantêm o comportamento existente e não criam agrupamentos duplicados.

## 8. Agrupamento pessoal por domínio

Nova preferência persistida no banco: `mail_group_by_domain`, padrão desativado, preservando a navegação atual até a escolha do usuário. É pessoal como o Resumo; não é uma configuração compartilhada da empresa.

Quando ativa, cada hostname completo forma um grupo acima das caixas: `aptechinfo.com.br`, `gmail.com`, etc. Subdomínios permanecem distintos. Dentro do grupo ficam somente as caixas autorizadas e, dentro delas, as pastas/etiquetas/filas atuais. Não agrupar pelo remetente das mensagens nem criar nomes manuais de grupos.

Resumo permanece acima dos grupos e agrega as mesmas caixas autorizadas. Nome da caixa e endereço devem ser identificáveis sem confundir duas caixas do mesmo domínio. Ordenação estável em pt-BR; expandir o grupo da caixa aberta. Persistir recolhimento por usuário, empresa e domínio como preferência local de navegação. Atualização de endereço ou revogação de acesso recalcula os grupos sem expor os demais domínios da empresa.

## 9. Política de exibição das filas

Adicionar `mail_queues_enabled` nos padrões de e-mail da empresa, padrão verdadeiro para compatibilidade. O nome do controle deve explicar a apresentação do atendimento. O cálculo interno continua ativo nos dois estados; não zerar filas, responsáveis, exclusões, notas, SLA ou histórico.

`useMailQueues` passa a ler a empresa atual. O campo individual legado deixa de decidir a experiência, sem precisar removê-lo destrutivamente do banco. Todos os usuários da mesma empresa recebem a mesma política; trocar de empresa pode mudar a exibição.

Com filas ocultas:

- Ocultar menus, badges, contadores, filtros e ações de atendimento, responsáveis e SLA nas caixas e no Resumo.
- Ajustar o Dashboard das caixas: preservar métricas de e-mail, remover blocos/atalhos de filas, SLA e produtividade de atendimento que deixariam de ter ação coerente.
- Tarefas, PDF, calendário, lembretes, agendamentos de envio, regras de e-mail, pastas, pesquisa e leitura continuam funcionando.
- Não produzir notificações visíveis de atribuição/SLA enquanto a política estiver desativada. Menções e tarefas seguem suas próprias regras existentes.
- URLs antigas para fila no e-mail/Resumo e filtros persistidos retornam à caixa de entrada correspondente, preservando contexto seguro e sem página quebrada.
- Leitura e recomputação internas continuam autorizadas pelas regras existentes. Mutações manuais exclusivas do atendimento devem ser rejeitadas pelo backend com orientação humana quando a política estiver desativada; jobs internos existentes não dependem dessa interface.

Ao reativar, recalcular a classificação com os dados atuais, preservando conclusões válidas, exclusões, responsáveis e tarefas. Não marcar tudo como pendente nem reorganizar conversas. Usar job idempotente com progresso/estado de falha por empresa; para grandes volumes, processar em lotes e atualizar a interface durante a reconciliação. A política de apresentação fica ativa imediatamente, com indicação de atualização até terminar; todos os endpoints continuam calculando/consultando o mesmo estado persistido, sem cópia paralela de filas.

Mudança de política é auditada e distribuída em tempo real. Não desligar agendadores de sincronização, SMTP, lembretes ou antivírus.

## 10. Conversas e atendimento independentes

### Regra confirmada

Uma mensagem nova não se une a outra apenas por assunto, remetente, destinatário ou proximidade temporal. Respostas reais usam os vínculos de `Message-ID`, `In-Reply-To` e `References`, sempre limitados à empresa e caixa corretas. Assunto normalizado continua útil para busca/exibição, não como prova de conversa.

No envio pelo APMail, a intenção é explícita: `kind=new` inicia conversa nova; `reply`/`reply_all` referenciam a mensagem escolhida; encaminhar inicia uma conversa nova de encaminhamento e mantém a relação de origem sem reutilizar a conversa como se fosse resposta. Agendamentos, recorrências, cópia enviada e reenvios idempotentes precisam respeitar a mesma intenção, sem gerar outra conversa a cada tentativa.

No recebimento/importação, priorizar o pai indicado em `In-Reply-To`; usar `References` como cadeia de ancestrais conhecida, não escolher o pai pela data mais recente de qualquer candidato. Sem vínculo resolvível, não recorrer a assunto/participantes.

Tratar respostas recebidas antes da mensagem original e importações fora de ordem por identidade dos cabeçalhos, não pela data. O plano técnico deve definir resolução pendente/mapeamento de referências para mensagens novas e cobrir concorrência e cópias IMAP. Uma cópia da mesma mensagem em outra pasta não deve abrir outra conversa nem mudar uma associação persistida por acidente.

Concluir modifica somente o estado de atendimento. Resposta genuína após conclusão permanece na conversa e reabre conforme as regras atuais; mensagem independente cria outra conversa mesmo se a anterior não estiver concluída. Pendências de tarefas continuam bloqueando a conclusão quando o atendimento está visível.

### Dados existentes e limite de correção

Não dividir ou unir em massa conversas antigas já persistidas nesta entrega: notas, tarefas, responsáveis, links e auditoria devem permanecer estáveis. A nova regra vale para mensagens e composições novas. Novas respostas podem continuar vinculadas a uma conversa antiga por referência explícita.

A reconciliação de importação fora de ordem não pode mover mensagens antigas para corrigir agrupamentos anteriores. Qualquer agrupamento provisório exclusivamente de mensagens novas só pode ser consolidado automaticamente antes de possuir notas, tarefas, atribuições ou ações humanas; depois disso, preservar identidade e registrar a relação de resposta para navegação. Essa preferência por preservação pode deixar conversas separadas quando não houver metadados suficientes ou o histórico já tiver sido operado; não prometer reconstrução perfeita de cabeçalhos ausentes.

## 11. Áreas de implementação e banco

Frontend: `components/layout`, rotas do painel e redirecionamentos, `lib/auth.ts`, `lib/settings.ts`, navegação de caixas/Resumo, preferências, CompanySettings, MailboxWizard, Dashboard e componentes existentes dos módulos movidos.

Backend: módulos administrativos de domínios/visão geral, consulta DNS isolada, `tenants.ts`, `mailboxes.ts`, exposição mínima da política em sessão, guards/mapeamento de permissões, auditoria e eventos. Reutilizar serviços de quota e segurança em vez de chamá-los por HTTP dentro da própria API.

Domínio/worker: `packages/db/src/domain/threads.ts`, pipeline de ingestão, outbox/MIME, agendamentos/recorrências, manutenção de filas e notificações de atendimento. Tipos/validações e permissões compartilhados em `packages/shared`.

Migrations novas, a partir do próximo número livre, para domínios/diagnósticos/vínculo das caixas, preferência pessoal, política empresarial e permissões; e suporte de referências/reconciliação se necessário ao desenho técnico. Constraints de tenant, unicidade e índices por consultas reais. Tipos gerados do banco de QA após aplicar migrations. Não alterar migrations já aplicadas.

Usar os controles de isolamento e autorização atuais do PostgreSQL/Fastify; não introduzir Supabase ou afirmar que existem políticas RLS novas sem implementá-las. Alterações de apresentação não concedem permissão de dados.

Nenhuma dependência nova é necessária por princípio: DNS, normalização e layouts podem usar recursos nativos e componentes existentes. Se uma lacuna exigir dependência, justificar no plano e confirmar compatibilidade.

## 12. Sequência macro e critérios de aceite

O plano técnico detalhado será produzido com a skill writing-plans após a aprovação deste desenho. Ordem proposta para reduzir regressões:

1. Fixar o comportamento de conversas com casos reproduzíveis e corrigir entrada/saída sem tocar em dados antigos.
2. Implementar política empresarial, atualização de filas e compatibilidade com Resumo/Dashboard.
3. Modelar domínios, backfill seguro, DNS e conexão de caixas.
4. Criar painel/layout, redirecionamentos e permissões, reutilizando as telas atuais.
5. Implementar visão geral administrativa e agrupamento pessoal.
6. Verificar fluxos críticos, revisar visualmente, corrigir e repetir somente o afetado; documentar a entrega.

Validação focada, sem bateria redundante:

- Conversas: dois e-mails novos de assunto igual permanecem separados; resposta e responder a todos mantêm a conversa; resposta após conclusão reabre; encaminhamento, rascunho, agendamento e cópia enviada mantêm a intenção; duplicata/importação fora de ordem não mistura conversas.
- Filas: habilitado/desabilitado, Resumo só de entrada, Dashboard sem links inválidos, notificações coerentes, reativação com estados atuais e histórico preservado.
- Domínios: normalização/unicidade, domínio em duas empresas, backfill de caixas, conexão existente e novo domínio, DNS ausente/timeout, seletor DKIM ausente e impossibilidade de remover domínio em uso.
- Acesso: administrador, delegado a uma seção, operador sem seções e pessoa de outra empresa. Testar endpoints e dados da visão geral, não apenas menus. Revogação e troca de empresa não mantêm dados antigos.
- Navegação: avatar, voltar ao e-mail, rotas legadas, OAuth de retorno e continuidade de transferências. Dashboard da caixa permanece acessível no lugar atual.
- Executar lint, typecheck, testes pertinentes/integrados com PostgreSQL e Redis de QA e build. Aplicar migrations em QA sem reset de banco real.
- Navegador real em 1440×900, 768×1024 e 390×844, nos temas claro/escuro, com teclado. Revisar um conjunto representativo de telas novas e fluxos alterados; corrigir após observação e revalidar. Sem inventar validação visual ou envio real.

## 13. Limites e publicação

Não há mudança de stack, administração universal de provedores, provisionamento remoto, alteração de DNS, comprovação de propriedade, verificação real de entregabilidade ou reparação em massa de conversas antigas.

Sem deploy, envio de mensagens reais ou alterações em banco de produção durante o planejamento. A implementação deve preparar migrations versionadas e instruções compatíveis com o deploy gerenciado pelo usuário no Dokploy. Permissões de commit/push devem seguir as instruções vigentes na etapa de execução; este documento não concede autorização nova.

## 14. Referências

- [Visão geral do console Zoho](https://www.zoho.com/mail/help/adminconsole/overview.html).
- [Dashboard da organização Zoho](https://www.zoho.com/mail/help/adminconsole/organization-dashboard.html): referência para reunir situação e pendências, adaptada ao escopo do APMail.
- [Domínios no Zoho](https://www.zoho.com/mail/help/adminconsole/add-domains.html): referência de diagnóstico; comprovação de propriedade e hospedagem própria foram excluídas pelo usuário.
- [RFC 5322, seção 3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4): identidade e referências de resposta; o documento não exige o fallback atual por assunto.
- [DNS nativo do Node.js](https://nodejs.org/api/dns.html): consulta de registros e erros; verificar os métodos usados na versão Node do projeto.

## 15. Decisões propostas pelo agente para revisão

São propostas técnicas conservadoras, não respostas atribuídas ao usuário: rotas `/admin`; domínios pessoais agrupados por hostname completo; agrupamento desativado por padrão; filas empresariais visíveis por padrão; criação mínima de domínio dentro da conexão de caixa; permissões de domínio separadas; DNS consultivo; nenhuma alteração em massa de conversas existentes; encaminhamentos como conversas novas; reativação das filas com atualização em lotes e preservação de histórico.
