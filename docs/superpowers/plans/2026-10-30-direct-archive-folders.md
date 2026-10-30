# Importação direta nas pastas da caixa

**Objetivo:** importar na organização normal de caixas POP3/IMAP; preservar importações em caixas locais separadas.
**Decisão:** remover somente invólucros conhecidos do PST; reconhecer pastas padrão apenas no primeiro nível útil; preservar nomes e hierarquia personalizados. Mensagens continuam com origem `archive`, sem upload ou exclusão no provedor.

- [x] Cobrir destinos padrão, subpastas, caixa separada e repetição com testes de banco.
- [x] Criar resolvedor reutilizável em `packages/db/src/domain/archive-folders.ts` e usá-lo no worker, substituindo o prefixo fixo.
- [x] Criar reorganização idempotente das pastas legadas, com isolamento por empresa/caixa, transação, preservação de IDs quando possível e união de pastas existentes. Nenhuma mensagem ou arquivo é excluído.
- [x] Validar tipos, lint, build e testes focados; testar ausência de perda/duplicação e persistência.
- [x] Fazer backup e organizar as três caixas sob bloqueio, conferindo contagens e hierarquia no banco. Inspeção visual bloqueada pelo controle do navegador (URL não confirmada no Windows).
- [x] Atualizar documentação. Commit e push na entrega; deploy permanece com o usuário conforme AGENTS.md.

Sem alteração de schema ou dependências. A correção de dados é manutenção autorizada pelo pedido; o novo comportamento depende de publicar o worker.
