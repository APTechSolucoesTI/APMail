# Perfis de acesso e auditoria

## Uso

Em **Configurações → Equipe e acesso → Perfis de acesso**, crie um perfil ou duplique
um dos quatro perfis do sistema, persistidos por empresa: Proprietário,
Administrador, Supervisor e Membro. Esses perfis padrão são protegidos. Atribua o
perfil ao convidar ou editar um usuário. Para criar uma função somente de convites,
selecione Consultar equipe e Convidar usuários.

Os papéis anteriores e as permissões das caixas/pastas são preservados. Proprietário
e Administrador continuam como papéis protegidos. Perfis personalizados substituem
o papel Membro; não concedem automaticamente acesso às caixas. Ações dependentes
selecionam também a permissão da tela correspondente. Um perfil vazio permite
somente as funções pessoais básicas, como perfil, preferências e segurança.

Administradores podem conceder perfis e acessos às caixas. Um gestor personalizado
só pode conceder permissões iguais ou inferiores às próprias e não altera o próprio
acesso nem contas administrativas. O perfil não pode ser excluído enquanto houver
usuários vinculados ou convites pendentes. Modificações valem nas próximas requisições
e atualizam os acessos conectados.

Os submenus separam mover, excluir, restaurar e sinalizar mensagens. Em contatos,
consulta, criação, edição e exclusão são ações independentes. Marcar uma categoria
não marca todas as ações; dependências são selecionadas automaticamente. Perfis
anteriores com permissões agrupadas são expandidos pela migration para preservar
suas ações. Os acessos a caixas e pastas continuam sendo uma segunda restrição.

Em **Permissões por usuário**, selecione um integrante para copiar e ajustar suas
permissões efetivas. Salvar cria um snapshot individual daquela associação à empresa:
outros usuários não mudam, e alterações posteriores no perfil não substituem a cópia.
**Restaurar permissões do perfil** remove a exceção e restabelece a herança. Trocar
o perfil/papel também limpa a cópia. Proprietários e administradores são protegidos.
As capacidades adicionais dos supervisores e os limites de exclusão dos contatos
globais são preservados para usuários com papéis legados; contatos pessoais continuam
excluíveis quando a permissão de exclusão estiver marcada.

A API valida dependências e limita a concessão ao acesso do gestor. Permissões são
relidas dentro do bloqueio transacional da empresa; revogações atualizam sockets e
são verificadas também nos envios, regras automáticas e alterações de pasta pendentes.

O convite continua sendo enviado pela caixa ativa padrão da empresa. Quem tem somente
permissão de convidar não precisa abrir a caixa nem configurar SMTP. Para evitar
elevação de privilégios, esse usuário só convida para perfis iguais ou inferiores
ao seu; não pode atribuir os papéis administrativos ou permissões de caixa.

## Auditoria

**Configurações → Auditoria** está disponível para Proprietário e Administrador.
Também pode ser liberada em um perfil personalizado. Supervisores com a permissão
anterior continuam limitados às caixas e pastas às quais já têm acesso.

O histórico inclui pesquisa por pessoa, assunto, destinatário ou ação, filtros de
usuário, ação, caixa e período, ordenação, paginação no servidor e exportação CSV
de até 10.000 resultados filtrados. As datas do filtro usam o fuso das preferências
do usuário, inclusive nas transições de horário de verão.

Nos detalhes, são mostrados responsável, e-mail, data, IP, caixa, destinatários,
anexos, campos alterados e resultados disponíveis, em linguagem de operação.
Envios, respostas, encaminhamentos e respostas automáticas são diferenciados.
Solicitar um envio/exclusão não equivale à sua conclusão: o processamento registra
o resultado ou a falha separadamente. Os eventos dos jobs têm chave de idempotência.

O nome do autor e o texto das mensagens são copiados no momento do evento, para
preservar o histórico após renomear um usuário ou remover/alterar a mensagem.
O texto é limitado a 200.000 caracteres por evento, com indicação de truncamento.
O corpo nunca faz parte da listagem, da exportação CSV ou dos metadados genéricos.
É devolvido somente pelo detalhe, com a permissão **Consultar conteúdo auditado**.
Consultar um conteúdo ou exportar o histórico gera outro evento de auditoria.
O conteúdo é mostrado como texto, sem executar HTML ou carregar imagens externas.

Também são auditados acessos, segurança, usuários, perfis, caixas, organização,
contatos, etiquetas, regras, compromissos, respostas a convites, lembretes, notas,
assinaturas, integrações e preferências nos respectivos pontos de alteração.
Os campos registrados variam por evento; nunca incluem senhas, códigos 2FA ou tokens.
O conteúdo de conversas do chat não é copiado para a auditoria administrativa.
Contatos pessoais de outros usuários permanecem excluídos do histórico consultável.

Registros antigos são preservados e exibem apenas as informações que possuíam.
Não é possível reconstruir retroativamente o texto ou a autoria que não foram
registrados antes desta versão. Eventos locais de envio indicam aceitação pelo
SMTP; não comprovam entrega na caixa do destinatário nem leitura.

## Arquitetura e publicação

- Migrations aditivas `0049_access_profiles_audit.sql` e `0050_audit_event_keys.sql`.
- Migrations `0053`–`0055`: perfis de sistema, granularidade, compatibilidade de
  nomes existentes e `tenant_members.custom_permissions` (`NULL` herda; `[]` nega
  os módulos). Não apagam nem renomeiam perfis personalizados existentes.
- `access_profiles`, associação em `tenant_members` e `invitations`, com FK composta
  por empresa e perfil, índices e proteção contra associação a outra empresa.
- Permissões e dependências centralizadas em `packages/shared/src/access.ts`.
- Contexto de autenticação relê o perfil a cada requisição. Rotas de perfis,
  ações administrativas, permissões de caixa, sockets e envios em background
  aplicam as verificações no servidor; ocultar menus é apenas parte da interface.
- Novas rotas operacionais devem ser incluídas no mapa `authz/profile-access.ts`;
  rotas desconhecidas são negadas a perfis personalizados por padrão.
- Auditoria centralizada em `packages/db/src/domain/audit.ts`. Resultados de envio
  e organização são registrados junto às transações; alterações auxiliares bem
  sucedidas passam pelo plugin `activity-audit.ts` com whitelist de campos.
- Novos campos de snapshot e índices em `audit_logs`; nenhum dado é apagado.
- Nenhuma variável ou serviço externo adicional. O migrador habitual aplica as
  migrations antes de iniciar os serviços. Deploy no Dokploy pelo usuário.

## Validação

Testes cobrem perfis restritos, convites e aceite, atribuição, revogação, dependências,
isolamento de empresa, prevenção de autoelevação, nomes duplicados, perfil em uso,
visibilidade de auditoria, leitura restrita de conteúdo, autoria preservada,
idempotência, exportação e snapshots após exclusão. O SMTP de testes é local;
nenhuma mensagem de validação precisa sair para destinatários reais.
