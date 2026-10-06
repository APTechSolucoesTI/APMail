# Publicação do APMail

## Revisão de 06/10/2026 — quota individual do provedor

Aplicar `0019_provider_account_quota.sql` (e migrations anteriores pendentes) e atualizar web/worker/API juntos. Essa migration limpa somente medições antigas do provedor; preserva limites do APMail, conteúdo e checkpoints. Os valores serão consultados novamente no próximo ciclo de sincronização. A leitura separa as raízes de quota e recusa informar capacidade de domínio ou raiz ambígua como se fosse individual. Quando o provedor não publica uma quota identificável da conta, a interface informa indisponibilidade.

As barras ficam na listagem de Configurações → Caixas de e-mail. A tela de e-mails mostra somente avisos a partir de 90%, limite atingido ou pausa por capacidade. Cadastro oferece Gmail/Google Workspace, Hotmail/Outlook.com, Outlook/Microsoft 365 e Outro; servidores Zoho existentes continuam funcionando e podem ser informados manualmente em Outro. Fontes dos presets Microsoft: [Outlook.com](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com) e [Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/pop3-and-imap4). Publicação pelo usuário, sem reset.

## Cotas — entrega de 06/10/2026

Aplicar `0018_storage_quotas.sql` e atualizar API, web e worker juntos. A migration é aditiva, preserva conteúdo e deixa empresas existentes sem limite definido. Antes de configurar cotas finitas em uma instalação com arquivos legados, conclua a reconciliação inicial no superadmin; referências ainda não conferidas impedem salvar a cota. Não execute reset do banco ou do volume para publicar estas alterações.

No `/superadmin`, selecionar a empresa e abrir Empresa/Armazenamento habilita limites de caixas e bytes. Proprietários e administradores redistribuem as cotas em Configurações → Empresa. Teste a retomada ampliando uma cota que tenha pausado a sincronização: o checkpoint permanece até a importação concluir, sem pular a mensagem bloqueada. A consulta de cota do provedor é por IMAP; ausência de suporte deve aparecer como indisponível. Regras e detalhes em [COTAS-ARMAZENAMENTO.md](COTAS-ARMAZENAMENTO.md).

O Compose principal cria PostgreSQL 17, Redis 7 com AOF/noeviction, migration, API, worker e web/nginx. Banco, Redis e arquivos têm volumes exclusivos; API e worker compartilham `storage`. A migration deve terminar com código 0 antes da aplicação iniciar. Os cinco serviços permanentes têm healthcheck e executam sem root. O arquivo principal contém somente portas internas (`expose`); o Dokploy encaminha o tráfego ao serviço `web`, porta 80.

## Correção de 06/10/2026 — convite do proprietário no cadastro de empresa

O cadastro pelo superadmin com um proprietário que ainda não tem conta depende da migration `0017_platform_owner_invitations.sql`. Ela atualiza a restrição dos convites para aceitar `owner` somente no contexto de plataforma; preserva os dados e o bloqueio de convites comuns para proprietário. Faça commit e redeploy pelo Dokploy e confira que o serviço `migrate` concluiu com código 0 antes de testar novamente o cadastro. Não edite migrations já aplicadas nem execute reset para esta correção. Código pronto no workspace; nenhuma alteração desta correção foi aplicada em produção pelo assistente.

## Complemento local de 05/10/2026 — publicação pelo usuário

Superadmin exclusivo e armazenamento implementados no workspace, sem commit/push/deploy pelo assistente. A última publicação anterior é o commit 6d0f711; esta alteração depende do commit e redeploy feitos pelo usuário. Não há nova migração de esquema. Recriar API, worker e web juntos aplica os controles de acesso e fecha as conexões antigas.

A conta usada para o bootstrap deve existir e será exclusiva da plataforma. Se a conta global atual também aparece como proprietário/admin de empresa, designe outro usuário comum como proprietário/admin pelo painel global antes da atualização. Vínculos históricos permanecem no banco; a autorização ignora esses vínculos para contas globais. Configure o acesso às caixas para a conta empresarial separada.

Armazenamento é uma estimativa dos corpos e arquivos registrados (uploads pendentes, anexos e assinaturas), incluindo dados excluídos ainda retidos. Não é medição de RAM ou do volume físico completo: índices/TOAST/WAL, backups, avatares e arquivos órfãos exigem conciliação separada antes de usar a métrica como cobrança por disco.

## Preparar o ambiente

Requer Docker Engine com BuildKit, Docker Compose v2, espaço para imagens/volumes e acesso do servidor aos provedores IMAP/SMTP. Para publicação externa, configure domínio/DNS, HTTPS e SMTP do sistema para convites e recuperação de senha. O SMTP do sistema é independente das credenciais de cada caixa, informadas pela interface.

Copie `.env.example` para `.env` e preencha:

- `APP_URL`: URL exata de acesso, incluindo protocolo e porta quando houver. Em produção pública, use `https://seu-dominio`.
- `POSTGRES_PASSWORD`: somente letras/números; gere com `openssl rand -hex 24`. O Compose monta a URL interna do banco automaticamente. Não reutilize a senha de desenvolvimento.
- `SESSION_SECRET` e `CREDENTIALS_ENCRYPTION_KEY`: duas chaves diferentes de 32 bytes, cada uma gerada com `openssl rand -base64 32`.
- `SYSTEM_SMTP_HOST`, `SYSTEM_SMTP_PORT`, `SYSTEM_SMTP_SECURE`, `SYSTEM_SMTP_USER`, `SYSTEM_SMTP_PASSWORD` e `SYSTEM_MAIL_FROM`. Use `true` para TLS implícito/465; em 587 use `false` e STARTTLS oferecido pelo servidor.
- `ALLOW_PUBLIC_SIGNUP=true` somente durante a criação do proprietário; depois altere para `false`.

Guarde `.env` com permissão 600, fora do Git, e as chaves em cofre de senhas. A perda da chave de criptografia exige redigitar as senhas das caixas. Variáveis `DATABASE_URL`/`REDIS_URL` do exemplo servem ao desenvolvimento e são substituídas pelos endereços internos no Compose de produção. `ALLOW_INSECURE_TLS_HOSTS` não desativa a validação TLS em produção.

## Testar em um host com Docker

```sh
cp .env.example .env
# Edite .env: segredos, APP_URL=http://localhost:8080 e SMTP.
chmod 600 .env
cp docker-compose.override.example.yml docker-compose.override.yml
docker compose up -d --build --wait --wait-timeout 180
docker compose ps -a
curl -fsS http://localhost:8080/api/health
docker compose logs migrate
```

O override publica somente `127.0.0.1:8080`; abra `http://localhost:8080/signup`. Cookies de produção são `Secure`; localhost serve para a validação local. Para acesso remoto normal, use HTTPS. Um túnel `ssh -L 8080:127.0.0.1:8080 usuario@servidor` permite revisar a instalação local a partir da estação.

Verifique: migration `Exited (0)`, cinco serviços `healthy` e saúde `{status:"ok",db:"ok",redis:"ok"}`. Crie proprietário/empresa, conecte caixa por senha de aplicativo, aguarde importação, responda um e-mail e confira dashboard/chat. Não execute `seed:dev` em produção.

```sh
docker compose restart api
curl -fsS http://localhost:8080/api/health
docker compose down
docker compose up -d --wait --wait-timeout 180
```

`down` sem `-v` preserva volumes. Nginx consulta o DNS interno do Docker a cada 10 segundos; API e Socket.IO podem se recuperar sem reiniciar web. `stop_grace_period=45s` permite encerrar conexões e jobs ativos.

## Publicar no Dokploy

1. Aponte o DNS do domínio para o servidor. Libere as portas necessárias para HTTPS e emissão do certificado; caixas precisam de saída IMAP/SMTP.
2. Em **Projects → Create Project**, crie **APMail**, em um ambiente exclusivo. Não reutilize serviços/bancos de outros projetos.
3. **Create Service → Compose**: Docker Compose, provedor GitHub, repositório `APTechSolucoesTI/APMail`, branch `main`, arquivo `./docker-compose.yml`. Autorize o repositório na instalação GitHub usada pelo Dokploy, se necessário.
4. Em **Environment**, informe as variáveis de produção acima, `NODE_ENV=production`, `APP_URL=https://seu-dominio` e segredos exclusivos. Habilite a geração do arquivo de ambiente. Não adicione o override local ao deploy público.
5. Em **Domains**, selecione domínio, **Service Name: web**, **Container Port: 80**, HTTPS e Let's Encrypt. Verifique que o DNS já resolve para o servidor.
6. Faça **Deploy** e acompanhe os logs. `migrate` deve terminar com **Migrations aplicadas** e código 0; confira saúde de Postgres, Redis, API, worker e web.
7. Acesse `/signup`, crie proprietário/empresa, altere `ALLOW_PUBLIC_SIGNUP=false` em Environment e faça redeploy. Novos membros entram por convite.
8. Em **Configurações → Caixas de e-mail**, conecte caixas reais. Valide convites/recuperação pelo SMTP do sistema, entrada de e-mail, resposta, anexo, dashboard e chat com duas contas.
9. Configure backup diário do banco, arquivos e chaves. Teste a restauração em banco e volume separados antes de depender do backup.

O [guia oficial de Compose](https://docs.dokploy.com/docs/core/docker-compose) e a [referência da API](https://docs.dokploy.com/docs/api/compose) complementam as telas do Dokploy. Credenciais, tokens e chaves nunca entram no Compose versionado.

## Backup e restauração

Pare os escritores para obter um conjunto consistente de banco e arquivos. Os comandos executados dentro do serviço usam suas variáveis internas; não exigem colocar senha na linha de comando.

```sh
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose stop api worker
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "backups/apmail-$stamp.dump"
docker compose run --rm --no-deps --entrypoint tar api -C /data/storage -czf - . > "backups/storage-$stamp.tar.gz"
docker compose start api worker
sha256sum "backups/apmail-$stamp.dump" "backups/storage-$stamp.tar.gz" > "backups/checksums-$stamp.txt"
```

Agende no host ou no Dokploy, mantenha cópia fora do servidor e monitore falhas. Preserve os segredos usados nesse backup em cofre. Redis pode ser incluído por snapshot/AOF do volume; jobs de envio são reconstruídos do Postgres pelo watchdog, mas manter Redis também preserva seus estados operacionais.

O script `scripts/backup-production.sh PROJETO_COMPOSE /diretorio/absoluto` automatiza o conjunto consistente: pausa API/worker, exporta banco e arquivos, salva snapshot Redis e as duas chaves em arquivo privado, calcula checksums e retoma os escritores mesmo se ocorrer falha. Usa os rótulos do projeto para encontrar exatamente seus serviços, sem acessar outros projetos; `flock` impede sobreposição. O diretório é privado e contém segredos. Leve uma cópia para armazenamento externo e guarde as chaves em cofre; backup no mesmo servidor não protege contra perda do host. Confira o log após cada execução.

Restaure primeiro em uma stack com outro nome (`docker compose -p apmail-restore ...`), seus próprios volumes e a **mesma chave de credenciais**. A aplicação deve estar parada. Exemplos para a stack de destino, após conferir seu nome e arquivos de ambiente:

```sh
docker compose stop api worker
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < backups/apmail-DATA.dump
docker compose run --rm --no-deps --entrypoint tar api -C /data/storage -xzf - < backups/storage-DATA.tar.gz
docker compose up -d --wait --wait-timeout 180
```

Confira usuários, caixas, conversas, hash de anexo e autenticação antes de liberar acesso. Não use `db:reset` nem `down -v` em uma instalação com dados que precisam ser preservados.

## Atualizar e diagnosticar

Push na `main` e redeploy no Dokploy, manualmente ou por webhook. Migrations têm checksum e são imutáveis; o migrador aplica somente versões novas. Faça backup antes de atualizar. Ao reverter versão, verifique compatibilidade do código com o schema atual; não apague migrations já aplicadas.

Use `docker compose logs --tail 100 api worker migrate` ou as telas de logs do Dokploy. API emite JSON com `request_id`, também retornado no header `X-Request-Id`; erros ao usuário não expõem segredos. `/api/health` é público e verifica banco/Redis; `/api/health/queues` exige administrador autenticado e mostra contagens e último heartbeat do worker. Examine estado da caixa e erro humano de conexão antes de mudar configurações do provedor.

## Situação da instalação local

Entrega local de 06/10/2026: contatos ampliados, cadastro próprio de empresas e busca global requerem as migrations aditivas `0020_contacts_primary_channels.sql` e `0021_company_directory.sql` e atualização conjunta de API/web. O migrador habitual aplica somente versões novas; não executar reset/seed. Cadastros/restrições existentes são preservados e a projeção de consumo lógico é atualizada. Esta etapa não aplicou alterações na produção; commit/deploy são feitos pelo usuário. Comportamento e validação em [CONTATOS-BUSCA-GLOBAL.md](CONTATOS-BUSCA-GLOBAL.md).

A instalação gerenciada está no projeto **APMail**, ambiente **production**, serviço Compose **APMail** do Dokploy em `http://192.168.3.106:3000`. O nome Compose efetivo é `apmail-next-production-qrufqc`, com banco, Redis, arquivos e segredos exclusivos. Endereço público: **https://apmail.aptechinfo.com.br:75**. Proprietário `sistema@aptechinfo.com.br`, empresa **APTech Soluções TI**, cadastro público desativado. Domínio, SMTP global e caixa real estão configurados. O ambiente atual do Dokploy é a fonte de verdade; `.data/qa/dokploy-production.env` é uma cópia antiga e não deve ser reaplicada. Não execute seed nessa instalação.

Abra o túnel e acesse `http://localhost:8081`:

```sh
ssh -L 8081:127.0.0.1:8081 administrador@192.168.3.106
```

O túnel local é opcional para diagnóstico. Na atualização, preserve os valores atuais de `APP_URL`, SMTP, segredos, volumes e configuração de domínio no Dokploy. Nenhuma caixa de QA deve ser copiada para produção.

Backup diário às **03h, fuso do host -03**, no crontab do usuário administrador. Script: `/home/administrador/apmail-next/scripts/backup-production.sh`; destino: `/home/administrador/apmail-next/.data/backups/production`; log: `backup.log` nesse diretório. API/worker pausam brevemente para manter banco e arquivos consistentes. Primeiro backup e restauração do proprietário em banco separado aprovados; banco de restauração removido depois da conferência. Os conjuntos incluem chaves privadas: mantenha cópia fora do host/cofre, monitore o log e planeje retenção conforme o espaço disponível. Não foi configurado armazenamento externo.

A validação completa de e-mail usa provedores GreenMail/Mailpit isolados. Esses provedores não fazem parte da instalação gerenciada. Veja as evidências em [PROGRESSO.md](PROGRESSO.md).

## Super admin e novas configurações

Após aplicar as migrations, conceda o acesso global a uma conta existente, pelo servidor:

```sh
docker compose exec -T api node node_modules/@apmail/db/dist/bootstrap-superadmin.js superadmin@aptechinfo.com.br
```

O comando exige DATABASE_URL/REDIS_URL do ambiente, verifica a comunicação com Redis, registra a concessão na auditoria global e sinaliza às APIs o encerramento imediato de conexões operacionais já abertas. A conta mantém a senha existente; `/superadmin` não possui cadastro público nem senha separada. Proprietários e administradores de empresas não recebem automaticamente o papel global. O painel gerencia empresas, usuários/vínculos/capacidades, caixas, auditoria, logs e saúde. Na implementação local de 05/10/2026, a conta global atua somente na plataforma; o suporte com acesso a conteúdo foi retirado, inclusive para sessões legadas. O painel inclui uso registrado por empresa/caixa. Contas globais precisam de uma conta empresarial separada para operar e-mails.

Convites da empresa usam sua caixa principal ativa, configurável em **Configurações → Empresa** e no próprio convite. Sem caixa ativa, conectar uma antes de convidar. Convites do super admin e recuperação de senha usam `SYSTEM_SMTP_*` e `SYSTEM_MAIL_FROM` globais. Falhas de entrega ficam no convite e podem ser reenviadas.

Importação inicial: `history_classify_days` entre 0 e 90; padrão 0 mantém histórico sem fila. Conversas existentes preservam elegibilidade; mensagens novas seguem classificação normal. A origem histórica permanece em movimentos e ressincronizações. Preferências migram uma única vez para claro/escuro, densidade fixa, notificações internas e imagens ativadas; notificação do navegador desativada. Escolhas posteriores são preservadas.

Contatos são exclusivos por e-mail normalizado dentro da empresa. Por padrão, todas as caixas atuais e futuras podem exibi-los. Restrição por caixas é administrativa; um usuário com acesso a qualquer caixa autorizada vê o contato completo. Consultas públicas de CEP/CNPJ têm timeout, cache e preenchimento manual. Imagens de assinatura requerem `APP_URL` HTTPS em produção e armazenamento persistente; não remover imagens antigas usadas em mensagens enviadas.

### Atualização de 05/10/2026

Dashboard é padrão para todos; Membro tem métricas pessoais e Supervisor/Admin visão geral somente no escopo permitido. Não exige nova concessão nem migração de banco. Cadastros e trocas de conexão/senha exigem testes IMAP e SMTP concluídos antes de persistir. A API precisa alcançar os provedores, além do worker. TLS/STARTTLS permanece obrigatório em produção; ALLOW_INSECURE_TLS_HOSTS só é considerado em desenvolvimento.

Assinaturas oferecem upload de imagem, com PNG normalizado e CID incorporado no MIME. Arquivos antigos do APMail continuam acessíveis e são convertidos no envio; não remover o armazenamento persistente. Imagens externas legadas precisam ser anexadas para serem incorporadas. Preserve ambiente, domínio, SMTP e volumes existentes ao redeployar.

### Gestão por empresa — implementação local de 05/10/2026

Publicação e commit ficam a cargo do usuário. Atualizar API e web juntos habilita o fluxo por empresa: escolher no /superadmin, então cadastrar/editar usuários e conexões ou consultar o armazenamento/auditoria/logs. Não há nova migração. Clientes internos das listagens GET /api/superadmin/users e GET /api/superadmin/mailboxes devem enviar tenant_id. O acesso operacional de contas globais continua bloqueado.

Criar usuário define senha inicial; o painel permite configurar acessos em seguida. Editar nome/e-mail/senha altera a identidade comum às empresas às quais a conta pertence. Convites de contas existentes e de proprietários novos continuam pelo SMTP global. Mudanças IMAP/SMTP/senha são testadas antes de salvar. Nenhum cadastro ou credencial de laboratório deve ser transferido para produção.

### Medição e dashboard — entrega de 05/10/2026

As migrations `0011`–`0016` e as imagens de API/web/worker devem ser publicadas juntas. São aditivas, preservam arquivos/caminhos e preenchem referências/projeção de dados lógicos. O worker faz inventário inicial e agenda publicação, incremental e inventário diário. O painel informa medições pendentes até a conferência completa. Preserve os volumes/segredos/SMTP e **APP_URL=https://app.apmail.com.br**, valor conferido na instalação atual. Não substitua por valores antigos desta documentação histórica.

Operação, fórmulas, limites e configuração das fontes opcionais de backups/logs/cgroups em [OPERACAO-ARMAZENAMENTO.md](OPERACAO-ARMAZENAMENTO.md). O Compose monta somente o diretório opcional de métricas para leitura. No host atual, Node não está instalado diretamente; o operador deve disponibilizar Node 22 ao coletor ou executá-lo em ambiente próprio, com mounts de leitura limitados às fontes configuradas, sem Docker socket nem container privilegiado. Sem essa configuração, essas fontes aparecem indisponíveis e não impedem a medição lógica/arquivos/banco/Redis.

Limpeza solicitada nesta entrega já executada no projeto `apmail-next-production-qrufqc`, banco `apmail`, volume `apmail-next-production-qrufqc_storage` e Redis exclusivo. Preservado schema `0010`; nenhum deploy ou migration nova em produção. Existe somente `sistema@aptechinfo.com.br` como superadmin, sem tenant/caixa. Login HTTPS e serviços verificados; a senha foi gerada fora do Git e entregue ao usuário.

Backup anterior à limpeza: `/home/administrador/apmail-next/.data/backups/production/20261005T182009Z`. Banco e arquivos restaurados em laboratório independente e conferidos; RDB validado. Credenciais/chaves do backup permanecem privadas. O relatório `backup-report.json` registra conclusão/checksum/restauração sem conteúdo ou segredos. Os recursos de laboratório com dados copiados foram removidos.

`APMAIL_BACKUP_LEAVE_STOPPED=true` é exclusivo de um procedimento operacional que prossegue com serviços parados, como o reset ensaiado nesta entrega. O cron normal não define essa variável e sempre retoma API/worker. Não executar novamente o script pontual de reset para atualizar o sistema; deploy normal preserva os cadastros criados após a limpeza.
