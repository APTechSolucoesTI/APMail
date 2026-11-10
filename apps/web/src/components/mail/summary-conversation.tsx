import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, X } from 'lucide-react';
import { api } from '@/lib/api';
import { canMailbox, useTenantId, type Mailbox } from '@/lib/auth';
import type { Folder, Thread } from '@/lib/mail';
import { cn } from '@/lib/utils';
import { useComposerPosition } from '@/hooks/use-composer-position';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Composer } from './composer';
import { ThreadView } from './thread-view';

export function SummaryConversation({
  thread,
  mailbox,
  userId,
  mode,
  setMode,
  onClose,
  restoreFocus,
}: {
  thread: Thread & { mailbox_id: string };
  mailbox?: Mailbox;
  userId: string;
  mode?: string;
  setMode: (mode?: string) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const tenant = useTenantId();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const help = useId();
  const position = useComposerPosition(tenant + ':' + userId, desktop, 'summary');
  const mailboxId = thread.mailbox_id;
  const folders = useQuery({
    queryKey: ['folders', tenant, mailboxId],
    queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
  });
  const mailboxName = mailbox?.name ?? thread.mailbox_name ?? 'Caixa de origem';
  const mailboxEmail = mailbox?.email_address ?? thread.mailbox_email;
  return (
    <Dialog open onOpenChange={(open) => !open && !mode && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        style={desktop ? position.style : undefined}
        className={cn(
          'flex min-w-0 flex-col gap-0 bg-card p-0 transition-none motion-reduce:animate-none sm:p-0',
          desktop
            ? 'h-[760px] max-h-[calc(100dvh-2rem)] w-[960px] max-w-[calc(100vw-2rem)] translate-none sm:max-w-[960px]'
            : 'left-0 top-0 h-dvh w-screen max-w-none translate-none rounded-none sm:max-w-none',
          position.dragging && 'ring-2 ring-primary/50',
        )}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-t-[inherit] border-b bg-muted/60 px-3 py-2',
            desktop && 'touch-none select-none',
          )}
          onPointerDown={position.onPointerDown}
          onPointerMove={position.onPointerMove}
          onPointerUp={position.onPointerUp}
          onPointerCancel={position.onPointerCancel}
        >
          <Mail className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle
              className="truncate text-sm leading-5 focus-visible:outline-2 focus-visible:outline-ring"
              tabIndex={desktop ? 0 : undefined}
              aria-describedby={desktop ? help : undefined}
              onKeyDown={position.onKeyDown}
            >
              Conversa do Resumo
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground" title={mailboxEmail}>
              {mailboxName}
              {mailboxEmail && mailboxName !== mailboxEmail ? ' · ' + mailboxEmail : ''}
            </p>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Fechar conversa" autoFocus>
              <X aria-hidden />
            </Button>
          </DialogClose>
        </div>
        <span id={help} className="sr-only">
          Use as setas para mover a janela. Shift acelera. Home restaura a posição inicial.
        </span>
        <span className="sr-only" role="status">
          {position.announcement}
        </span>
        <div className="min-h-0 flex-1 overflow-hidden rounded-b-[inherit]">
          <ThreadView
            threadId={thread.id}
            mailboxId={mailboxId}
            folders={folders.data ?? []}
            onClose={onClose}
            onCompose={mailbox && canMailbox(mailbox, 'send') ? setMode : undefined}
            showBackButton={false}
          />
        </div>
        {mode && (
          <Composer
            mailboxId={mailboxId}
            threadId={thread.id}
            mode={mode}
            trapFocus
            onClose={() => setMode()}
            onReopen={(id) => setMode('draft:' + id)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
