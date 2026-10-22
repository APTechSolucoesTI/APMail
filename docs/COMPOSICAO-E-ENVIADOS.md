# Composição pessoal e mensagens enviadas

Em **Preferências → Composição**, cada usuário define fonte, tamanho em pixels,
cor, negrito, itálico, sublinhado e tachado. O padrão pessoal vale para suas caixas;
uma caixa pode ter uma exceção própria. **Usar padrão pessoal** remove a exceção.
As fontes dependem das fontes disponíveis no cliente do destinatário e usam fallbacks.

Os padrões iniciam novos e-mails, respostas e encaminhamentos. Alterações manuais
valem apenas para a mensagem atual. Rascunhos reabertos preservam o HTML salvo.
A formatação é serializada no HTML transmitido, não apenas aplicada visualmente.

A assinatura fica dentro do editor e pode ser editada ou apagada. O conteúdo é um
snapshot da mensagem; editar esse conteúdo não modifica a assinatura cadastrada.
Selecionar outra assinatura substitui somente o bloco atual. Imagens continuam
usando os arquivos autorizados do usuário e referências CID no MIME.
Clientes que enviam somente `signature_id` continuam recebendo a assinatura
cadastrada; um bloco explicitamente vazio não restaura o modelo.

**Enviados** lista cada mensagem separadamente, com paginação e pesquisa no servidor.
Abrir, mover ou excluir um envio pela lista ou detalhe afeta aquela mensagem.
Conversas nas demais visualizações mantêm seu agrupamento e suas ações próprias.
Cabeçalhos de resposta e o histórico que efetivamente integra o corpo enviado
continuam preservados. A cópia salva corresponde ao MIME transmitido.

## Persistência e autorização

- Migration aditiva `0051_composition_preferences.sql`.
- `user_preferences.composition_format`: padrão pessoal, compartilhado pelas caixas
  daquele usuário, inclusive em outras empresas das quais participe.
- `mailbox_composition_preferences`: exceções por empresa, usuário e caixa, com
  chave primária composta, integridade referencial e índices. RLS habilitado;
  o backend segue o modelo de autorização da aplicação e exige sessão e acesso à caixa.
- `GET/PUT /api/preferences/composition`: validação compartilhada por schema,
  consulta sem N+1 e nenhuma alteração nas configurações de outros usuários.
- Detalhes aceitam `message_id` e/ou `folder_id`, sempre limitados à empresa,
  caixa e pastas legíveis. Links antigos de Enviados sem mensagem abrem o envio
  mais recente da conversa naquela pasta, independentemente da página da lista.

## Validação local

Os testes de integração cobrem persistência, isolamento de usuário/empresa,
remoção de exceção, payload inválido, listagem individual, pesquisa e detalhes
limitados à pasta. O fixture SMTP local verifica assinatura editada, preservação
do modelo, HTML formatado e igualdade entre o corpo transmitido e a cópia salva.
Nenhum teste depende do envio de mensagens a destinatários externos.
