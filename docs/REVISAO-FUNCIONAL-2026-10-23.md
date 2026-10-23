# Revisão funcional — 23/10/2026

Revisão em ambiente local isolado, anterior à apresentação ao cliente. Nenhuma alteração em dados de produção, dependências ou schema. Publicação pelo Dokploy permanece a cargo do usuário.

## Rascunhos na caixa de e-mail

- Envios contém somente Agendados, Na fila e Com falha.
- A pasta Rascunhos da caixa reúne os rascunhos privados do compositor e as mensagens de pastas de rascunhos legíveis do provedor. Não move nem exclui dados existentes.
- Se a caixa ainda não possuir uma pasta de rascunhos, a navegação oferece o acesso local correspondente, depois de Entrada/Enviados.
- Busca e paginação ocorrem no servidor. O compositor existente reabre o mesmo registro, com destinatários, conteúdo e anexos. As atualizações usam as invalidações e eventos existentes.
- Rascunhos privados continuam restritos ao autor, tenant e caixa. O acesso não depende da permissão ao módulo Envios; a leitura da caixa e a permissão para enviar/editar continuam sendo respeitadas. Rascunhos do provedor mantêm a visualização de mensagens existente.

Áreas principais: `modules/mailbox-drafts.ts`, autorização do detalhe de outbox, `MailboxDrafts`, rota de e-mail, árvore de pastas e tela Envios. Sem migration necessária.

## Problemas corrigidos na revisão

1. Responder a uma mensagem de Enviados agora preenche os destinatários originais, removendo endereços próprios e duplicados.
2. A limpeza de uploads preserva anexos de envios com falha que ainda permitem nova tentativa.
3. A edição de uma ocorrência recorrente respeita a opção de enviar atualização aos participantes.
4. A criação de Google Meet permite nova tentativa após rejeição explícita da criação pelo Google. Timeout, falha de rede e respostas incertas preservam a proteção contra criação duplicada.
5. Rascunhos de diferentes pastas do provedor abrem pela mensagem correta, sem combinar identificadores de pastas incompatíveis.
6. Ações dos lembretes ficam abaixo do conteúdo no celular, preservando a leitura do título.

## Validação executada

| Verificação                                                          | Resultado                    |
| -------------------------------------------------------------------- | ---------------------------- |
| ESLint do repositório                                                | Aprovado                     |
| Typecheck de todos os pacotes                                        | Aprovado                     |
| Build de shared, db, API, worker e web                               | Aprovado                     |
| Unitários shared / db / API / worker                                 | 104 / 42 / 11 / 39 aprovados |
| Testes web                                                           | 138 aprovados, 45 arquivos   |
| Testes Python do importador PFF                                      | 11 aprovados                 |
| Integrações da API, PostgreSQL/Redis                                 | 154 aprovadas, 17 arquivos   |
| Integrações worker de contatos/MDN/MIME/convites/regras/agendamentos | 27 aprovadas, 2 arquivos     |
| Revisão de diff e `git diff --check`                                 | Aprovada                     |

Os testes do worker usam SMTP local controlado; Google é simulado nos testes de integração. Regressões novas tiveram falha reproduzida antes da correção e aprovação posterior.

### Navegador real

Edge/Playwright, com API e banco reais de teste:

- Criação, autosave, fechamento, reabertura, edição e persistência de rascunho após recarregar.
- Resposta a mensagem enviada com destinatário preenchido; anexo salvo e reaberto; cancelamento e confirmação da exclusão de rascunho.
- Visualização de rascunho importado de uma segunda pasta, navegando pela primeira.
- Navegação em Dashboard, Calendário, Lembretes, Contatos, Relatórios, Preferências, Empresa, Equipe e acesso, Perfis, Auditoria, Assinaturas, Regras e Integrações.
- Criação de compromisso com antecedência de lembrete, consulta da persistência e recarregamento; criação e edição de lembrete com persistência.
- Envios com as três abas corretas; temas claro e escuro; viewports 1440×900, 768×1024 e 390×844. Houve revisão das capturas, correção do layout mobile dos lembretes e nova validação.
- Rodadas finais sem erros de console, respostas de API com falha ou overflow horizontal nos cenários verificados.

A primeira varredura com muitos recarregamentos rápidos atingiu o limite local de 300 requisições/minuto. A repetição com intervalos de navegação passou; a proteção de produção foi mantida.

## Limites da validação

Não foram enviados e-mails a destinatários externos nem criadas salas reais no Google. Entrega externa, autenticação OAuth e interoperabilidade ao vivo com Gmail/Outlook dependem das contas e configurações do ambiente publicado. A suíte completa de sincronização IMAP exige GreenMail, indisponível neste ambiente; não foi executada. Esses limites não são apresentados como testes aprovados.
