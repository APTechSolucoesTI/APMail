# Organização das importações diretas — 30/10/2026

Manutenção solicitada para a empresa APTech, exclusivamente nas caixas Maíra, Contato e Financeiro. O Financeiro foi organizado somente após a importação chegar ao fim. Não houve deploy, reenvio de PST, alteração de credenciais ou operação no provedor.

| Caixa      | Mensagens preservadas (todas as origens) | Origem archive preservada | Pastas personalizadas reposicionadas | Mensagens unidas às pastas padrão |
| ---------- | ---------------------------------------: | ------------------------: | -----------------------------------: | --------------------------------: |
| Maíra      |                                    7.316 |                     7.140 |                                  135 |                             1.955 |
| Contato    |                                    1.270 |                     1.207 |                                    3 |                             1.136 |
| Financeiro |                                    4.792 |                     4.773 |                                  167 |                             1.119 |

Cada caixa foi processada em transação, sob o mesmo bloqueio Redis da sincronização/importação. Foram preservados os IDs de mensagens, referências MIME, chaves de origem, tamanhos e datas de exclusão. Pastas personalizadas conservaram seus IDs. Entrada/Enviados/Lixeira/Spam foram unidos às pastas oficiais da caixa; os sete invólucros antigos de cada caixa foram desativados somente após ficarem sem mensagens ou filhos ativos. Não foram excluídos arquivos nem mensagens.

Conferência após o commit: nenhuma pasta ativa sob `local/importados`, nenhum filho ativo sob pai desativado e as mesmas 13.120 mensagens de origem archive. A segunda execução nas caixas já organizadas não realizou alterações. Eventos de atualização de pastas/listagens foram publicados para as sessões da aplicação.

Backups dos vínculos e metadados anteriores estão fora do Git em `.data/relocation-backup/archive-folders-2026-10-30.json`; cópias restritas também foram mantidas temporariamente no worker. Não contêm credenciais ou corpos de e-mail.

Validação do código: quatro testes de banco, incluindo isolamento, repetição e bloqueio de ampliação de permissões; vinte integrações do worker aprovadas (duas de exportação PST não executadas por dependerem do conversor externo), tipos, lint dos arquivos alterados e build de shared/db/worker. A inspeção visual foi tentada, mas o controle do navegador foi encerrado por não conseguir confirmar a URL atual no Windows. Não foi contornada essa restrição.

O padrão das próximas importações depende de publicar o novo worker com `@apmail/db`, conforme `DEPLOY.md`. A organização acima já foi aplicada no banco existente.
