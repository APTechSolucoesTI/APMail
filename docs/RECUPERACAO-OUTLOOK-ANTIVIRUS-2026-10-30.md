# Correções de importação Outlook e antivírus — 30/10/2026

## Publicação

Publicar **API e worker da mesma revisão**, incluindo `@apmail/db`. A migration aditiva `0068_archive_content_recovery.sql` já foi aplicada em produção e no banco de QA. Não há mudança de interface nem necessidade de reenviar os PSTs.

O leitor agora respeita BOM, charset HTML e propriedades MAPI de codificação, inclusive citações ANSI em HTML UTF-8. As declarações HTML são alinhadas ao MIME UTF-8 reconstruído. CSS embutido é convertido em estilos inline por `juice` (sem buscar recursos externos), preservando fontes, tabelas e realces amarelos. Scripts, carregadores CSS remotos e imagens não verificadas continuam protegidos. Referências CID são restauradas nas exportações após verificar os anexos.

Referências técnicas: [codificação MAPI](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtaginternetcodepage-canonical-property), [inlining de CSS](https://github.com/Automattic/juice).

## Antivírus

A falha operacional foi `clamd` tentando abrir `/tmp/clamd.log` em diretório protegido. A configuração da instância compartilhada e sua fonte no host foram ajustadas para `/var/log/clamav/clamd.log`, com backup. O motor voltou a healthy/online; arquivo limpo e assinatura inofensiva EICAR foram verificados no scanner real, sem gravar arquivo de teste.

O código retoma apenas a fila antivírus, verifica saúde/pendências fora da fila acumulada e antecipa exclusivamente erros transitórios quando o motor retorna. Anexos têm prioridade sobre MIME/contêineres de backup. Métricas incluem tarefas priorizadas. Vereditos de malware e erros de política não são liberados por essa recuperação.

Foi instalado no host o timer `apmail-antivirus-watchdog.timer` (60 segundos). Ele confere nome, labels e ID do único scanner esperado antes de agir; respeita inicialização, pausa/parada explícita e cooldown de cinco minutos. Em unhealthy, corrige somente a linha antiga conhecida do log e reinicia o mesmo ID. Isso também protege contra retorno da configuração antiga em um futuro rebuild externo. Código e testes estão em `scripts/antivirus-watchdog.py`, `scripts/tests/` e `infra/systemd/`. O APMail não recebe acesso ao Docker socket.

## Recuperação dos dados existentes

Os PSTs de Contato, Financeiro e Maíra são lidos sem alteração. A recuperação associa cada mensagem pelo SHA256 do MIME original, conserva IDs, pastas, estados, anexos, chave de origem e MIME bruto. Somente corpo, snippet e a identidade alternativa da reconstrução são atualizados, com journal anterior a cada alteração. `archive_reconstructed_key` permite deduplicar o MIME corrigido e exportar o conteúdo recuperado, mantendo o original para auditoria.

Ferramentas e journals foram preservados fora dos containers, no diretório privado `/home/administrador/.apmail-maintenance/outlook-20261030`. A recuperação é idempotente e pode continuar após uma troca de container. Caracteres já perdidos no conteúdo de origem não são inventados.

## Validação

Testes de decodificação Python 3.11/3.12, sanitização, deduplicação, exportação CID e quarentena; suítes de DB/worker e integrações focadas; lint, tipos e builds. O conteúdo real recuperado foi renderizado pelo `EmailBodyFrame` em 1440×900, 768×1024 e 390×844, com acentos e realce amarelo conferidos e sem erros JavaScript. O watchdog foi testado com Docker simulado em Linux/Windows e validado por systemd, sem derrubar o motor saudável.
