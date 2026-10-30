# Destinatários de PST/OST — 30/10/2026

## Correção

O `pypff` do Debian Bookworm não expõe `.recipients`, e os destinatários dos enviados não aparecem em `number_of_sub_items`. O importador agora lê a tabela própria de destinatários por meio da API pública da mesma `libpff`, abrindo o PST somente para leitura. Versões novas de `pypff` usam `.recipients` diretamente.

São preservados Para, CC e CCO, com nomes e endereços SMTP, sem confundir metadados de anexos com destinatários. Cabeçalhos válidos existentes prevalecem; cabeçalhos vazios/grupos sem endereço usam os dados MAPI disponíveis. Leitura nativa com erro interrompe com diagnóstico em vez de omitir silenciosamente os destinatários. Nenhum endereço ausente no original é inventado.

## Publicação

Reconstruir/publicar o **worker**, que já copia todos os arquivos de `apps/worker/scripts`. Sem migration ou dependência adicional: a biblioteca nativa já acompanha `python3-pypff` instalado na imagem.

## Histórico recente

Foi iniciada recuperação pontual em segundo plano das cinco importações recentes da APTech, sem reenviar PSTs, excluir registros ou regravar corpos/anexos. A seleção por assunto serve somente para evitar conversões irrelevantes; **a associação e a atualização exigem o SHA256 exato da reconstrução anterior**, conferido contra `source_key` ou `archive_reconstructed_key`.

Somente arrays vazios Para/CC/CCO são preenchidos. IDs, MIME original, anexos, pastas, estados e datas permanecem. A identidade alternativa é atualizada para deduplicar novas importações da reconstrução corrigida. Participantes das conversas são recalculados. Há backup anterior a cada atualização. A operação respeita o bloqueio da caixa e aguarda importações ativas; pode continuar após uma troca de container.

Ferramentas, checkpoints e journals privados estão no host em `/home/administrador/.apmail-maintenance/recipients-20261030`. `status.log` contém somente resumos; `pass-*.private.log` contém também os backups e não deve ser publicado. Uma linha `COMPLETE` confirma término; `ATTENTION` exige consultar o erro. O trabalho não precisa de acompanhamento contínuo na conversa.

## Validação

18 testes Python de reconstrução, incluindo os três tipos de destinatário, preservação de cabeçalhos e bytes de anexos; typecheck e build do worker. Teste com a biblioteca nativa do servidor recuperou os destinatários e preservou anexos em mensagens enviadas reais. Prévia sem alteração de dados encontrou reparos com correspondência exata de hash nas cinco importações.

Referência da biblioteca: [API de mensagens libpff](https://github.com/libyal/libpff/blob/main/pypff/pypff_message.c).
