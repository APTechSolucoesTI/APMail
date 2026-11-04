import type { ReactNode } from 'react';
import { ContextMenu as Menu } from 'radix-ui';
import { ClipboardPaste } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { canMailbox, useAccess, useTenantId, useUserId, type Mailbox } from '@/lib/auth';
import type { Folder } from '@/lib/mail';
import { pasteCutMail, useCutMail } from '@/lib/mail-cut';

export function FolderPasteMenu({
  mailbox,
  folder,
  children,
  className,
}: {
  mailbox: Mailbox;
  folder?: Folder;
  children: ReactNode;
  className?: string;
}) {
  const tenant = useTenantId();
  const user = useUserId();
  const { cut, busy } = useCutMail(tenant, user);
  const client = useQueryClient();
  const mayMove = useAccess('mail.move');
  const permitted =
    mayMove &&
    canMailbox(mailbox, 'read') &&
    canMailbox(mailbox, 'organize') &&
    canMailbox(mailbox, 'move');
  const destination =
    !!folder && folder.special_use !== 'drafts' && mailbox.status === 'active' && permitted;
  const canPaste =
    destination &&
    !busy &&
    !!cut &&
    cut.messages.some((message) => cut.mailboxId !== mailbox.id || message.folderId !== folder.id);
  const paste = async () => {
    if (!tenant || !user || !folder || !canPaste) return;
    try {
      if (!(await pasteCutMail(tenant, user, mailbox.id, folder.id))) return;
      await Promise.all(
        ['threads', 'thread', 'folders', 'queue-counts'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(
        'Movimentação solicitada. Os e-mails aparecerão no destino após a sincronização.',
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível colar o e-mail. Tente novamente.',
      );
    }
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={!destination}>
        <div
          className={className}
          onContextMenu={(event) => {
            if (
              (event.target as HTMLElement).closest(
                'article, [role="dialog"], [role="menu"], [aria-label="Conversa"], input, textarea, button, a, label, select, [contenteditable="true"]',
              )
            )
              event.preventDefault();
          }}
        >
          {children}
        </div>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          aria-label="Ações da pasta"
          collisionPadding={8}
          className="z-50 w-48 max-w-[var(--radix-context-menu-content-available-width)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <Menu.Label className="max-w-64 truncate px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
            {folder?.name}
          </Menu.Label>
          <Menu.Item
            disabled={!canPaste}
            onSelect={() => void paste()}
            className="flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 lg:min-h-8"
          >
            <ClipboardPaste className="size-4" aria-hidden />
            {busy ? 'Colando…' : 'Colar'}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
