# Operação do armazenamento e painel da plataforma

O `/superadmin` abre no dashboard consolidado. Cadastro e edição de usuários e caixas continuam exigindo seleção de empresa. O painel de métricas não concede acesso a mensagens, anexos ou imagens privadas.

## O que os números significam

- **Dados atribuídos:** payload lógico persistido + bytes aparentes de arquivos presentes, sem repetir identidades físicas. Não representa páginas físicas exclusivas do PostgreSQL.
- **Dados lógicos:** `logical-json-v1`. Corpos HTML/texto em UTF-8, separados do JSONB canônico dos demais campos. O catálogo `storage_logical_catalog` identifica todas as relações e campos excluídos. Identidades, sessões e gestão sem tenant pertencem à plataforma; entidades sem caixa pertencem à empresa. O registro de medição é excluído da própria fórmula.
- **Arquivos presentes:** `lstat.size`, deduplicados por dispositivo/inode. Arquivos compartilhados por caixas aparecem uma vez na empresa. Uploads novos associados a uma caixa pertencem àquela caixa, mesmo antes de vincular um rascunho. Uploads legados sem atribuição e imagens originais de assinatura pertencem à empresa; cópias MIME salvas em mensagens pertencem à caixa. Avatares pertencem à plataforma. Não se somam tamanhos MIME originais a esses valores. A política de limites e admissão está em [COTAS-ARMAZENAMENTO.md](COTAS-ARMAZENAMENTO.md).
- **Disco alocado:** `lstat.blocks × 512` no Linux. Em ambientes sem suporte, fica indisponível. Não constitui alocação exclusiva de reflinks/blocos comprimidos.
- **Dados retidos:** subconjunto do total, incluindo registros com exclusão lógica, registros de empresas/caixas excluídas e anexos de mensagens excluídas. Detalhes separam payload e arquivos retidos. Não somar retenção novamente ao total.
- **Banco físico:** tamanho global do PostgreSQL; tabelas, índices e TOAST separados, WAL compartilhado separado. Não ratear entre empresas. A projeção de medição e demais custos técnicos também ocupam o banco físico.
- **Volume:** capacidade/livre do filesystem que contém os arquivos. O mesmo disco pode conter outros projetos. Volumes com o mesmo dispositivo compartilham capacidade: não somar essas capacidades.

Bytes são strings decimais na API e são formatados com `BigInt`. Apenas coordenadas de gráficos são convertidas para MiB com arredondamento. CSV preserva bytes e filtros; exportação usa uma transação com snapshot consistente e fluxo em páginas. Não inclui caminhos físicos, conteúdo, nomes de anexos ou credenciais.

## Migração e coleta

As migrations `0011`–`0016` são aditivas. Cadastram referências, preservam os arquivos e inicializam uma projeção de payload atualizada na mesma transação dos registros de domínio. Não recalculam corpos grandes toda vez que se abre o dashboard. A inicialização da projeção lê as tabelas existentes; reserve uma janela para bases grandes e faça backup antes de migrar.

Compatibilidade ensaiada: imagem legada com schema aditivo e dados originalmente legados. Após criar imagens privadas de assinatura, não retornar à API antiga que publicava qualquer ID de `signature_images`: ela desconhece a restrição `legacy_public` e os novos URLs privados. Um rollback desse período exige uma versão que preserve a proteção nova, ou restauração consistente de banco/arquivos do backup anterior com os serviços parados. Não é seguro apenas trocar para a imagem antiga mantendo imagens privadas novas no mesmo banco.

Depois do deploy, o worker agenda a fila `storage-metering`, sem consumir a concorrência de IMAP/SMTP:

| Processo                    | Padrão                                                   |
| --------------------------- | -------------------------------------------------------- |
| Publicação e infraestrutura | 60 segundos                                              |
| Conferência de alterações   | 15 minutos                                               |
| Inventário completo         | 04h30, `America/Sao_Paulo`, depois do backup das 03h     |
| Lote/duração de trabalho    | 5.000 arquivos / 20 segundos                             |
| Histórico                   | Uma observação por hora por 90 dias; diária até 24 meses |

Configurações: `STORAGE_PUBLISH_SECONDS` (mínimo 60), `STORAGE_SCAN_BATCH` (100–10.000), `STORAGE_SCAN_BUDGET_MS` (1–30 segundos), `STORAGE_HISTORY_HOURLY_DAYS` (padrão 90) e `STORAGE_HISTORY_DAILY_MONTHS` (padrão 24). A fila usa um consumidor por processo; um advisory lock do PostgreSQL mantém uma coleta por volume/aplicação entre réplicas. Esse lock permanece na conexão, sem expiração artificial durante uma coleta, e é liberado se a conexão/processo morrer.

O inventário percorre diretórios em streaming, consulta referências em lotes pequenos e registra cursor durável. Reabrir um inventário pula os arquivos já observados na mesma execução. Uma segunda etapa verifica referências ausentes. Comparação de revisão impede que o scanner sobrescreva uma gravação mais recente. A conferência não lê conteúdo e não segue links simbólicos; caminhos vindos do navegador nunca são aceitos.

O filesystem ativo não é um snapshot atômico: a publicação e o último inventário completo têm horários próprios, apresentados na tela. `Pendente` indica ausência de inventário completo; `Parcial` indica divergência, leitura incompleta, falha recente ou inventário completo há mais de 48 horas. A interface sinaliza publicações com mais de 15 minutos. Uma falha de travessia não publica zeros e preserva a última medição.

O botão **Reconciliar arquivos** solicita trabalho em segundo plano e reaproveita uma solicitação em andamento. O histórico de execuções fica em **Integridade**. Operação pelo terminal:

```sh
pnpm storage:reconcile full
pnpm storage:reconcile changed
```

Uma solicitação em andamento pode reenfileirar a mesma execução com cursor durável caso sua continuação tenha sido removida/cancelada. O botão é limitado por 30 segundos e registra retomadas na auditoria; execução duplicada de estado terminal não publica outra medição. Esgotamento das tentativas do worker marca o run como falho, conservando os últimos totais publicados. Uma nova reconciliação poderá ser solicitada.

Dentro da imagem do worker/API já construída, a mesma CLI fica em `node_modules/@apmail/db/dist/reconcile-cli.js`. Ela usa o ambiente do próprio serviço. Não trocar `DATABASE_URL` por um banco de outro projeto.

## Infraestrutura e permissões de coleta

O worker coleta PostgreSQL, Redis, filesystem e seu processo/cgroup. Métricas sem fonte ou permissão ficam **Indisponíveis**, sem assumir consumo zero. WAL pode exigir permissão adicional de leitura; o painel funciona mesmo sem ela.

Backups, logs físicos, outros volumes e cgroups de API/worker/web podem vir de um coletor independente no host. Ele não usa socket Docker, não executa comandos em containers e não lê o conteúdo de arquivos de clientes. Precisa somente de acesso para listar/traversar os diretórios explicitamente configurados e ler arquivos técnicos dos cgroups. Não monte o diretório de dados PostgreSQL ou o Docker socket no worker.

1. Copie `docs/examples/metrics-host.example.json` para uma configuração privada fora do Git. Substitua os caminhos pelos recursos exatos do projeto. Remova fontes não disponíveis; não use `/` ou diretórios que incluam outras aplicações. Os caminhos de cgroups precisam ser atualizados quando os containers forem recriados.
2. Execute no host: `pnpm --filter @apmail/db storage:collect-host /CAMINHO/metrics-host.json`. O JSON resultante contém somente identificadores de origem, bytes, capacidade, dispositivo, memória, CPU e data. A substituição do arquivo é atômica.
3. Configure uma execução por minuto usando a conta operacional com acesso somente às fontes necessárias. CPU é a diferença entre duas amostras, em percentual de um núcleo, podendo ultrapassar 100% em múltiplos núcleos. Uma única amostra deixa CPU indisponível.
4. Defina `APMAIL_METRICS_DIRECTORY` no deploy para o diretório **que contém** `infra.json`. O Compose o monta somente para leitura em `/data/metrics`. `INFRA_METRICS_FILE=/data/metrics/infra.json` já está no Compose. O diretório deve existir e o arquivo deve ser legível pelo UID do worker.

Alternativamente, `BACKUP_METRICS_DIR`, `LOG_METRICS_DIR` e `REDIS_METRICS_DIR` permitem coleta local de metadados quando os diretórios já estão montados somente para leitura. Coletas possuem orçamento de tempo/arquivos; falha ou orçamento excedido não é declarado como tamanho zero. Sem instalar/configurar as fontes do host no deploy, esses itens ficam indisponíveis. O diretório opcional `.data/metrics` não faz parte dos arquivos de clientes.

`backupReport` é opcional e aponta somente para o JSON operacional produzido pelo script de backup: conclusão, checksum verificado e data de restauração ensaiada. O coletor não verifica nem lê dumps/arquivos de clientes. Conclusão e restauração são estados distintos; `restored_at` somente deve ser preenchido pelo operador após um ensaio real. Conceda leitura desse relatório separadamente, sem conceder leitura dos segredos/dumps. Dados ausentes aparecem como não registrados.

Alertas configuráveis `DISK_WARNING_PERCENT`/`DISK_CRITICAL_PERCENT` (80%/90%), `SYNC_DELAY_MINUTES` (10) e `WORKER_HEARTBEAT_SECONDS` (90) são operacionais. A previsão utiliza variação **do espaço livre físico do mesmo dispositivo/capacidade**, com pelo menos sete dias observados e fonte atual. Não usa crescimento lógico para estimar disco. Não há prazo se o histórico for insuficiente ou o crescimento nulo/negativo. Outros projetos/backups no mesmo filesystem influenciam a estimativa. Não existem planos, cotas, cobrança ou bloqueios de envio por armazenamento.

## Divergências e privacidade

Integridade identifica arquivo ausente/inacessível, diferença de tamanho, temporário antigo, arquivo sem referência, operação interrompida e referência incompatível entre empresas. Temporários/órfãos têm tolerância de cinco minutos. Nenhum botão apaga ou movimenta arquivos; correção destrutiva exige procedimento operacional separado. Operações malsucedidas permanecem no histórico; nova observação resolve sua divergência quando o arquivo foi reconciliado.

Imagens novas de assinatura são privadas em `signatures/{tenant}/{user}/{id}.png`; prévia autenticada exige usuário e empresa proprietários. Os envios incorporam a imagem via CID. Registros antigos explicitamente marcados `legacy_public` conservam a URL pública para compatibilidade. Não há acesso anônimo a imagens novas. Anexos continuam exigindo tenant, caixa e pasta autorizados.

## Laboratório e limpeza autorizada

`pnpm --filter @apmail/db storage:benchmark` exige Linux, pelo menos 8 GiB livres e um banco exclusivo chamado `apmail_storage_scale_test`. Gera um milhão de mensagens, cem mil arquivos e cem caixas; confere bytes/contagens e registra tempo e pico de RSS. Nunca apontar esse comando ao banco da aplicação. O diretório temporário de arquivos é removido ao final; o banco exclusivo deve ser removido pelo operador após o laboratório.

`scripts/reset-production-data.mjs` é uma ferramenta pontual para a limpeza **explicitamente autorizada nesta entrega**, restrita ao projeto verificado no servidor. Exige serviços parados, confirmação textual, identificação do banco/Redis dedicado e backup com checksums válidos. Preserva schema, migrations, catálogo e configuração do deploy. Remove dados, arquivos e filas da aplicação; cria somente um superadmin sem tenant/caixa e grava sua senha gerada em arquivo privado. Não é rotina de manutenção nem botão do produto.

Backup e restauração seguem `scripts/backup-production.sh` e `docs/DEPLOY.md`. A limpeza não aplica migrations novas nem publica imagens: o commit e o deploy continuam a cargo do usuário.
