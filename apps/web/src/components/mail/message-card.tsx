import { useState } from 'react';
import { Download, Paperclip, Eye, Flag } from 'lucide-react';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Message, Folder, Attachment } from '@/lib/mail';
import { EmailBodyFrame } from './email-body-frame';
import { MessageActions } from './message-actions';
import { ContactSenderAction } from '@/components/contacts/contact-editor';
import { resolveAddress, type ContactResolution } from '@apmail/shared';
import { ReadReceipt } from './read-receipt';
import { CalendarInvitation } from './calendar-invite';
export function MessageCard({
  message,
  expanded,
  cidMap,
  loadRemoteImages,
  organize,
  mailboxId,
  folders,
  onCompose,
  contacts = {},
  timeZone = 'America/Sao_Paulo',
}: {
  message: Message;
  expanded: boolean;
  cidMap: Record<string, string>;
  loadRemoteImages: boolean;
  organize: boolean;
  mailboxId: string;
  folders: Folder[];
  onCompose?: (mode: string) => void;
  contacts?: ContactResolution;
  timeZone?: string;
}) {
  const [open, setOpen] = useState(expanded),
    [preview, setPreview] = useState<Attachment | null>(null);
  const date = new Date(message.message_at).toLocaleString('pt-BR', { timeZone });
  const sender = resolveAddress(
    { name: message.from_name, address: message.from_address },
    contacts,
  );
  const contactAddress =
    message.direction === 'outbound' && message.to_addresses.length
      ? message.to_addresses[0]!
      : { name: message.from_name, address: message.from_address };
  const contactIdentity = resolveAddress(contactAddress, contacts);
  return (
    <article className="rounded-lg border bg-card text-card-foreground">
      <header className="grid grid-cols-1 items-start gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <UserAvatar name={sender.name} size={32} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="block w-full rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="break-words text-sm font-semibold">
                {sender.name}{' '}
                {message.is_flagged && <Flag className="inline size-3" aria-label="Sinalizada" />}
              </p>
              <p className="break-all text-xs text-muted-foreground">{message.from_address}</p>
              {!open && (
                <p className="mt-1 truncate text-xs text-muted-foreground" title={message.snippet}>
                  {message.snippet}
                </p>
              )}
            </button>
            {!message.is_mdn && (
              <ContactSenderAction
                email={contactAddress.address}
                name={contactAddress.name}
                identity={contactIdentity.contact}
                className="mt-1 -ml-2 min-h-11 px-2 text-xs sm:h-8 sm:min-h-8"
              />
            )}
          </div>
        </div>
        <time
          dateTime={message.message_at}
          className="pl-11 text-xs tabular-nums text-muted-foreground sm:pl-0 sm:text-right"
        >
          {date}
        </time>
      </header>
      {open && (
        <div className="space-y-3 border-t p-4">
          <ReadReceipt message={message} canSend={!!onCompose} timeZone={timeZone} />
          {message.calendar_invite && (
            <CalendarInvitation messageId={message.id} timeZone={timeZone} canSend={!!onCompose} />
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              Para{' '}
              {message.to_addresses.map((a) => resolveAddress(a, contacts).name).join(', ') ||
                'destinatários não informados'}
            </summary>
            <p className="mt-2 break-all">
              Para:{' '}
              {message.to_addresses
                .map((a) => {
                  const resolved = resolveAddress(a, contacts);
                  return resolved.name === a.address
                    ? a.address
                    : resolved.name + ' — ' + a.address;
                })
                .join(', ')}
            </p>
            {!!message.cc_addresses.length && (
              <p className="break-all">
                Cc:{' '}
                {message.cc_addresses
                  .map((a) => {
                    const resolved = resolveAddress(a, contacts);
                    return resolved.name === a.address
                      ? a.address
                      : resolved.name + ' — ' + a.address;
                  })
                  .join(', ')}
              </p>
            )}
          </details>
          {message.sent_by && (
            <p className="text-xs text-muted-foreground">
              Enviado por {message.sent_by.full_name} via APMail
            </p>
          )}
          <EmailBodyFrame
            html={
              message.body_html ?? message.body_text.replace(/</g, '&lt;').replace(/\n/g, '<br>')
            }
            cidMap={cidMap}
            loadRemoteImages={loadRemoteImages}
          />
          {!!message.attachments.filter((a) => !a.is_inline).length && (
            <ul className="flex flex-wrap gap-2">
              {message.attachments
                .filter((a) => !a.is_inline)
                .map((a) => (
                  <li
                    key={a.id}
                    className="flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted/50 p-2"
                  >
                    <Paperclip className="size-4 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium" title={a.filename}>
                        {a.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Math.ceil(a.size_bytes / 1024)} KB
                      </p>
                    </div>
                    {/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.content_type) && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={'Visualizar ' + a.filename}
                        onClick={() => setPreview(a)}
                      >
                        <Eye />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a
                        href={'/api/attachments/' + a.id + '/download'}
                        aria-label={'Baixar ' + a.filename}
                      >
                        <Download />
                      </a>
                    </Button>
                  </li>
                ))}
            </ul>
          )}
          {message.pending_action ? (
            <p role="status" className="text-xs text-muted-foreground">
              Aplicando alteração no servidor…
            </p>
          ) : (
            organize && (
              <MessageActions
                mailboxId={mailboxId}
                folders={folders}
                messageIds={[message.id]}
                flagged={message.is_flagged}
              />
            )
          )}
          {onCompose && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onCompose('reply:' + message.id)}>
                Responder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCompose('reply_all:' + message.id)}
              >
                Responder a todos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCompose('forward:' + message.id)}
              >
                Encaminhar
              </Button>
            </div>
          )}
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.filename}</DialogTitle>
            <DialogDescription>Pré-visualização do anexo recebido.</DialogDescription>
          </DialogHeader>
          {preview?.content_type.startsWith('image/') ? (
            <img
              src={'/api/attachments/' + preview.id + '/inline'}
              alt={preview.filename}
              className="max-h-[65dvh] max-w-full object-contain"
            />
          ) : (
            preview && (
              <iframe
                src={'/api/attachments/' + preview.id + '/inline'}
                title={preview.filename}
                sandbox=""
                className="h-[65dvh] w-full rounded-md border"
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
