import { useState } from 'react';
import { useRouterState, useNavigate } from '@tanstack/react-router';
import { Keyboard } from 'lucide-react';
import { can } from '@apmail/shared';
import type { Mailbox } from '@/lib/auth';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
const shortcuts = [
  ['c', 'Novo e-mail'],
  ['/', 'Focar a busca'],
  ['j / k', 'Próxima / anterior conversa'],
  ['r', 'Responder'],
  ['a', 'Responder a todos'],
  ['f', 'Encaminhar'],
  ['e', 'Concluir conversa'],
  ['Esc', 'Fechar painel ou diálogo'],
  ['?', 'Mostrar atalhos'],
];
export function KeyboardHelp({ mailboxes }: { mailboxes: Mailbox[] }) {
  const [open, setOpen] = useState(false),
    path = useRouterState({ select: (state) => state.location.pathname }),
    navigate = useNavigate(),
    box = mailboxes.find((b) => b.status === 'active' && can(b.role, 'send'));
  useKeyboardShortcuts({
    '?': () => setOpen(true),
    ...(!path.startsWith('/mail/') && box
      ? {
          c: () =>
            void navigate({
              to: '/mail/$mailboxId',
              params: { mailboxId: box.id },
              search: { compose: 'new' },
            }),
        }
      : {}),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Atalhos de teclado"
        onClick={() => setOpen(true)}
      >
        <Keyboard aria-hidden className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atalhos de teclado</DialogTitle>
            <DialogDescription>
              Disponíveis no desktop quando o foco estiver fora de campos de edição. As ações seguem
              suas permissões.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2">
            {shortcuts.map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 border-b pb-2 text-sm"
              >
                <dt>{label}</dt>
                <dd>
                  <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">{key}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
