import { ReceivedAttachment, SecuredEmailBody } from './attachment-safety';
import { AttachmentPdfPreview } from './attachment-pdf-preview';
import { useId, useState } from 'react';
import { Flag, Plus, Minus, Reply, ReplyAll, Forward } from 'lucide-react';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { MailActionButton } from './mail-action-button';
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
import { flattenFolders } from '@/lib/mail';
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
  const bodyId = useId();
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
  // Blocked inline files also need visible release controls, including inline PDFs without a CID.
  const visibleAttachments = message.attachments.filter(
    (a) => !a.is_inline || !a.content_id || a.security?.status !== 'clean',
  );
  return (
    <article className="@container/message rounded-lg border bg-card text-card-foreground">
      <header className="grid grid-cols-1 items-start gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <UserAvatar name={sender.name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1 text-sm font-semibold">
              {sender.contact && !message.is_mdn ? (
                <ContactSenderAction
                  email={message.from_address}
                  name={sender.name}
                  identity={sender.contact}
                  inlineName
                  className="min-h-11 min-w-0 break-words rounded-sm text-left font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6"
                />
              ) : (
                <span className="break-words">{sender.name}</span>
              )}
              {message.is_flagged && <Flag className="inline size-3" aria-label="Sinalizada" />}
            </div>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">De</dt>
              <dd className="min-w-0 break-all">{message.from_address}</dd>
              {(
                [
                  ['Para', message.to_addresses],
                  ['Cc', message.cc_addresses],
                  ['Cco', message.bcc_addresses ?? []],
                ] as const
              ).map(
                ([label, addresses]) =>
                  (label === 'Para' || addresses.length > 0) && (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 break-words">
                        {addresses.length
                          ? addresses.map((address, index) => {
                              const identity = resolveAddress(address, contacts);
                              return (
                                <span key={address.address + index} className="break-all">
                                  {index > 0 && '; '}
                                  {identity.contact && !message.is_mdn ? (
                                    <ContactSenderAction
                                      email={address.address}
                                      name={identity.name}
                                      identity={identity.contact}
                                      inlineName
                                      className="min-h-11 rounded-sm text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6"
                                    />
                                  ) : identity.name !== address.address ? (
                                    identity.name
                                  ) : null}
                                  {identity.name !== address.address ||
                                  (identity.contact && !message.is_mdn)
                                    ? ' — '
                                    : ''}
                                  {address.address}
                                </span>
                              );
                            })
                          : 'Destinatários não informados'}
                      </dd>
                    </div>
                  ),
              )}
            </dl>
            {!open && (
              <p className="mt-1 truncate text-xs text-muted-foreground" title={message.snippet}>
                {message.snippet}
              </p>
            )}
            {!message.is_mdn && !contactIdentity.contact && (
              <ContactSenderAction
                email={contactAddress.address}
                name={contactAddress.name}
                identity={contactIdentity.contact}
                className="mt-1 -ml-2 min-h-11 px-2 text-xs sm:h-8 sm:min-h-8"
              />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pl-11 sm:justify-end sm:pl-0">
          <time
            dateTime={message.message_at}
            className="text-xs tabular-nums text-muted-foreground sm:text-right"
          >
            {date}
          </time>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-11 shrink-0 sm:size-8"
            onClick={() => setOpen((value) => !value)}
            aria-label={(open ? 'Recolher' : 'Expandir') + ' mensagem de ' + sender.name}
            aria-expanded={open}
            aria-controls={bodyId}
          >
            {open ? <Minus aria-hidden /> : <Plus aria-hidden />}
          </Button>
        </div>
      </header>
      {open && (
        <div id={bodyId} className="space-y-3 border-t p-4">
          {(onCompose || organize || message.pending_action) && (
            <div
              role="group"
              aria-label="Ações da mensagem"
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3"
            >
              {onCompose && (
                <div
                  role="group"
                  aria-label="Responder e encaminhar"
                  className="flex flex-wrap items-center gap-1"
                >
                  <MailActionButton
                    label="Responder"
                    onClick={() => onCompose('reply:' + message.id)}
                  >
                    <Reply aria-hidden />
                  </MailActionButton>
                  <MailActionButton
                    label="Responder a todos"
                    onClick={() => onCompose('reply_all:' + message.id)}
                  >
                    <ReplyAll aria-hidden />
                  </MailActionButton>
                  <MailActionButton
                    label="Encaminhar"
                    onClick={() => onCompose('forward:' + message.id)}
                  >
                    <Forward aria-hidden />
                  </MailActionButton>
                </div>
              )}
              {message.pending_action ? (
                <p role="status" className="text-xs text-muted-foreground">
                  Aplicando alteração no servidor…
                </p>
              ) : (
                organize && (
                  <div
                    role="group"
                    aria-label="Organizar mensagem"
                    className="flex flex-wrap items-center gap-1 border-l pl-3"
                  >
                    <MessageActions
                      mailboxId={mailboxId}
                      folders={folders}
                      messageIds={[message.id]}
                      flagged={message.is_flagged}
                      inTrash={flattenFolders(folders).some(
                        (folder) =>
                          folder.id === message.folder_id && folder.special_use === 'trash',
                      )}
                    />
                  </div>
                )
              )}
            </div>
          )}
          <ReadReceipt message={message} canSend={!!onCompose} timeZone={timeZone} />
          {message.calendar_invite && (
            <CalendarInvitation messageId={message.id} timeZone={timeZone} canSend={!!onCompose} />
          )}
          {message.sent_by && (
            <p className="text-xs text-muted-foreground">
              Enviado por {message.sent_by.full_name} via APMail
            </p>
          )}
          {message.attachments.some((attachment) => attachment.is_inline) ? (
            <SecuredEmailBody
              attachments={message.attachments.filter((attachment) => attachment.is_inline)}
              html={
                message.body_html ?? message.body_text.replace(/</g, '&lt;').replace(/\n/g, '<br>')
              }
              cidMap={cidMap}
              loadRemoteImages={loadRemoteImages}
            />
          ) : (
            <EmailBodyFrame
              html={
                message.body_html ?? message.body_text.replace(/</g, '&lt;').replace(/\n/g, '<br>')
              }
              cidMap={cidMap}
              loadRemoteImages={loadRemoteImages}
            />
          )}
          {!!visibleAttachments.length && (
            <ul className="flex flex-wrap gap-2">
              {visibleAttachments.map((a) => (
                <ReceivedAttachment key={a.id} attachment={a} onPreview={setPreview} />
              ))}
            </ul>
          )}
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
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
              <AttachmentPdfPreview attachmentId={preview.id} filename={preview.filename} />
            )
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
