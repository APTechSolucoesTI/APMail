# APMail instalado e links da Curciol

Abra [APMail](https://app.apmail.com.br) no navegador de desktop e use **Instalar APMail** na barra de endereço ou no menu. A instalação usa o manifesto em `/manifest.webmanifest`. Se já havia um atalho ou uma instalação anterior, reinstale caso o navegador ainda não tenha registrado `web+apmail`.

| Origem                                            | Link aberto pela Curciol                                  | Destino no APMail                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caixa em `mailboxes[].url` da API de notificações | `web+apmail://abrir?caminho=` + `encodeURIComponent(url)` | `/mail/<mailboxId>?assigned=any` ou `/invitations`, conforme o valor da API                                                                           |
| UUID interno `data.id` da API de mensagens        | `web+apmail://mensagem/<id>`                              | `/mail/<mailboxId>?folderId=<folderId>&thread=<threadId>&message=<id>&assigned=any` ou `/invitations?thread=<threadId>` quando o acesso é por convite |
| Abertura de teste                                 | `web+apmail://abrir?caminho=%2F`                          | `/`                                                                                                                                                   |

O navegador encaminha o link completo para `/abrir-externo?u=%s`, codificando o valor de `u`. A rota aceita `/`, `/mail/<UUID>` e `/invitations` no formato `caminho` e preserva os filtros. Links inválidos caem no início. A resolução de mensagem usa `GET /api/messages/:id/location` com a sessão do APMail e as permissões de leitura da conversa e da pasta. Mensagens ausentes ou inacessíveis também caem no início.

Com a sessão encerrada, o destino fica guardado na janela para ser validado novamente após o login, inclusive após a segunda etapa quando habilitada. A navegação substitui a entrada no histórico.

## Como testar

1. Depois do deploy, instale o APMail em Chrome, Edge ou Brave no desktop. A partir de outra página, clique no link de abertura de teste e aceite a confirmação do navegador, se aparecer.
2. Com o app aberto em outra tela, clique numa caixa da Curciol. Confira se a mesma janela abre a caixa e preserva os filtros. Repita com o UUID interno de uma mensagem permitida.
3. Repita com a sessão encerrada e confira o destino após o login. Teste também com um UUID inexistente ou sem acesso e confira o retorno ao início.
4. Em um perfil de teste sem o protocolo registrado, o clique da Curciol não deve abrir uma aba do APMail. O aviso de instalação é apresentado pela Curciol. A observação de foco é um sinal aproximado e depende do navegador e do sistema.
5. Compare os cabeçalhos antes e depois do deploy com `curl -I https://app.apmail.com.br/abrir-externo`. O manifesto deve responder com `Content-Type: application/manifest+json`.

O modo `navigate-existing` leva a janela aberta ao destino. Isso pode recarregar a tela e perder texto que ainda não tenha sido salvo em rascunho. Abrir o app pelo ícone também pode levar a janela existente ao início. O frontend usa navegação de rede e não registra service worker.

[Critérios de instalação](https://web.dev/articles/install-criteria) · [Registro de protocolos](https://developer.chrome.com/docs/web-platform/best-practices/url-protocol-handler) · [Reuso de janela](https://developer.chrome.com/docs/web-platform/launch-handler)
