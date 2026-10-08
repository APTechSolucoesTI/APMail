# Contatos Outlook, etiquetas e busca — 07/10/2026

Implementado conforme [plano aprovado](PLANO-CONTATOS-OUTLOOK-LISTAGENS-ETIQUETAS.md). Commit e deploy pelo usuário. Migration vigente: `0023_contacts_outlook_label_mailboxes.sql`.

## Agenda e permissões

Proprietário/admin escolhe Global ou Individual em Configurações → Empresa. A escolha vale obrigatoriamente para novos cadastros, inclusive pelo remetente e por importação. Não existe escolha por contato nem vínculo de visibilidade a caixa. **Trocar o modo não converte contatos antigos e não compartilha agendas privadas anteriores.**

Globais pertencem à tenância; qualquer membro ativo pode criar, visualizar e editar. Individuais pertencem ao usuário, inclusive perante admins. A agenda mostra globais + próprios individuais. Exclusão global exige gestão de contatos; dono pode excluir os próprios individuais. Outra tenância e superadmin não leem a agenda operacional.

Nome global repetido é bloqueado, comparando caixa/acentos/espaços. E-mail é único na agenda global ou na agenda individual do proprietário; usuários distintos podem ter o mesmo e-mail em agendas privadas sem revelar duplicidades. Nomes privados podem se repetir. O formulário recomenda nome completo e apelido para identificação.

## Campos e validação

Nome completo, apelido privado, Empresa e Cargo em texto. Autocomplete de Empresa/Cargo consulta contatos visíveis por ILIKE, normaliza grafias equivalentes e admite texto novo. **Não existem tabela, API ou cadastro ativo de empresas do diretório.** /companies redireciona para Contatos. Tenâncias e Configurações → Empresa permanecem.

Campos Outlook complementares: nome/meio/sobrenome/prefixo/sufixo, departamento/escritório, site/aniversário/observações; vários e-mails e telefones com título/tipo e principal; vários endereços opcionais, próprios do contato. CEP pode ser consultado com Enter ou botão, com preenchimento manual se indisponível.

Nome e ao menos um canal válido são obrigatórios. E-mails validam sintaxe e são normalizados; não se afirma existência ou entrega. Telefones são validados com metadados completos de libphonenumber, BR por padrão e internacional com +código do país, normalizados em E.164. Formato inválido, DDD inválido ou números repetidos após normalização são recusados. Principal único por conjunto não vazio.

Ficha mostra criador/data/hora e último editor/data/hora; sem autoria histórica comprovada informa Não registrado no histórico. Edição usa versão e avisa conflito para evitar sobrescrever alterações recentes. Meu apelido só altera o registro privado, sem mudar autoria compartilhada.

## Importar CSV/VCF

Contatos → Importar, exclusivamente arquivo do usuário. CSV UTF-8/BOM ou Windows-1252, vírgula/ponto e vírgula, campos com aspas e notas multilinha, cabeçalhos PT/EN e mapeamento manual. VCF 3.0/4.0 suporta linhas dobradas, múltiplos cartões/canais/endereços e escapes. Não busca fotos ou recursos remotos. Campos ignorados são identificados no mapeamento/diagnóstico; NICKNAME não é publicado automaticamente.

Até 10 MiB e 10.000 registros. Prévia das primeiras 100 linhas, com nome, empresa, canais e diagnóstico; todos são validados. Ignorar existentes ou atualizar: atualização preserva campos ausentes/vazios, canais adicionais, endereços, criador e apelidos. Colisões com vários contatos exigem revisão manual. Contato telefônico corresponde por nome + telefone, sem fusão só por telefone.

Lotes de até 100; cursor e resultado de cada linha são transacionais. Repetir confirmação não duplica a gravação. Interromper após este lote preserva progresso. Cota cheia mantém cursor; ampliar capacidade permite Continuar. Modo alterado pelo admin exige nova prévia. Política de duplicatas não muda após início. Importações recentes/relatórios são privados por 24 horas, medidos no armazenamento e limpos na manutenção diária. Relatório pode ser baixado. Modelos CSV/VCF disponíveis no diálogo.

## Busca, histórico e envio

Nome, Empresa, Cargo, meu apelido, e-mail e telefone são pesquisáveis. Busca global mantém categorias Contatos, E-mails, Caixas, Configurações, Filas, Etiquetas, Pastas, Envios e Chat; não inclui empresa de diretório. APIs filtrarão acesso antes de sugestões, totais e paginação. Eventos e auditoria não publicam conteúdos de agendas privadas.

Histórico usa e-mails do contato e limita mensagens às caixas/pastas autorizadas. Contato telefônico pode existir, mas Enviar novo e-mail exige cadastrar destinatário. Envio escolhe e-mail do contato e caixa remetente; com várias caixas, exige escolha. De/Para podem mudar depois, preservando rascunho, anexos e assinatura e revalidando permissão/cota.

## Etiquetas e regras

Globais no topo, pessoais abaixo, nome/cor/escopo no menu e nos seletores. Cor RGB livre com gradiente/hex e controles de teclado. Pessoal só gerenciada pelo dono, global só por proprietário/admin. Supervisor recebe capacidades explícitas, sem gestão global automática.

Disponibilidade Todas inclui futuras caixas elegíveis; Selecionadas exige ao menos uma autorizada. Vínculo não concede acesso. Menu, contadores e resultados ficam na caixa atual e em suas pastas permitidas, sem misturar conversas de caixas distintas. IDs de caixas inacessíveis não são expostos.

Globais aplicadas são compartilhadas na conversa, com deltas explícitos/auditoria; pessoais permanecem privadas. Retirar caixa oculta aplicações antigas e desativa regras afetadas com motivo; voltar a autorizar restaura visualização. Minhas regras aceita só pessoais próprias; regras da caixa só globais válidas. API, banco e worker revalidam. Regras pessoais antigas que usavam global ficam inativas para revisão.

## Listagens e publicação

Padrão ConfigurableTable: busca, filtros digitáveis no topo de colunas, ciclo asc/desc/sem ordenação, Colunas com visibilidade/ordem/tamanho, paginação superior/inferior, 10 inicial e 10/20/30/50/100. Identificação permanece visível. Preferências por usuário/listKey. Dados ilimitados são filtrados/ordenados antes da paginação no servidor; conjuntos agregados/limitados podem usar cliente. Mobile usa cards, ações em menu; temas claro/escuro e teclado.

Migration 0023 remove somente empresas/vínculos/legado do antigo diretório de teste; preserva contatos, canais, apelidos, caixas e mensagens. Empresa principal vira texto quando disponível. Projeções/catalogação de consumo removem dados obsoletos, medem importações/vínculos e não cobram duas vezes. Backfill suporta cota previamente cheia. Publicar migration/API/web/worker juntos; conferir [DEPLOY.md](DEPLOY.md) e [PROGRESSO.md](PROGRESSO.md).
