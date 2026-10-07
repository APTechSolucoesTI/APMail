import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import {
  can,
  outboxSchema,
  replySubject,
  replyRecipients,
  quoteHtml,
  type OutboxInput,
  type OutboxAttachment,
  type ReplyKind,
  type ReplyMessage,
} from '@apmail/shared';
import { Send, Clock, Paperclip, X, Trash2, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useComposingPresence } from '@/hooks/use-thread-presence';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { signaturePreview } from '@/lib/signature';
import { meQuery, useTenantId, canMailbox, type Mailbox } from '@/lib/auth';
import type { Outbox, Signature } from '@/lib/outbox';
import type { ThreadDetail } from '@/lib/mail';
import { RichTextEditor } from '@/components/forms/rich-text-editor';
import { EmailChipInput } from './email-chip-input';
import { ScheduleDialog } from './schedule-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
type Attached = { ref: OutboxAttachment; filename: string; size_bytes: number };
export type ComposerHandle = { saveDraft: () => Promise<void> };
const blank = (id: string): OutboxInput => ({
  mailbox_id: id,
  kind: 'new',
  to_addresses: [],
  cc_addresses: [],
  bcc_addresses: [],
  subject: '',
  body_html: '',
  signature_id: null,
  attachments: [],
});
export function Composer({
  mailboxId,
  mode,
  threadId,
  initialRecipient,
  onClose,
  onReopen,
  ref,
}: {
  mailboxId: string;
  mode: string;
  threadId?: string;
  initialRecipient?: { address: string; name: string };
  onClose: () => void;
  onReopen: (id: string) => void;
  ref?: Ref<ComposerHandle>;
}) {
  const desktop = useMediaQuery('(min-width: 1024px)'),
    [minimized, setMinimized] = useState(false),
    [maximized, setMaximized] = useState(false);
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery);
  const company = useQuery({
    queryKey: ['tenant', tenant],
    queryFn: () => api<{ settings: { max_attachment_mb?: number } }>('/tenant'),
  });
  const draftId = mode.startsWith('draft:') ? mode.slice(6) : null;
  const replyId = /^(reply|reply_all|forward):/.test(mode) ? mode.split(':')[1] : null;
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const signatures = useQuery({
    queryKey: ['signatures', tenant],
    queryFn: () => api<Signature[]>('/signatures'),
  });
  const draft = useQuery({
    queryKey: ['outbox-detail', tenant, draftId],
    queryFn: () => api<Outbox>('/outbox/' + draftId),
    enabled: !!draftId,
  });
  const conversation = useQuery({
    queryKey: ['thread', tenant, threadId],
    queryFn: () => api<ThreadDetail>('/threads/' + threadId),
    enabled: !!replyId && !!threadId,
  });
  const [data, setData] = useState<OutboxInput>(() => blank(mailboxId)),
    [body, setBody] = useState(''),
    [quote, setQuote] = useState(''),
    [signatureHtml, setSignatureHtml] = useState(''),
    [files, setFiles] = useState<Attached[]>([]);
  const [ready, setReady] = useState(false),
    [edited, setEdited] = useState(false),
    [cc, setCc] = useState(false),
    [bcc, setBcc] = useState(false),
    [expandedQuote, setExpandedQuote] = useState(false),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [savedAt, setSavedAt] = useState(''),
    [error, setError] = useState(''),
    [schedule, setSchedule] = useState(false),
    [confirm, setConfirm] = useState<'discard' | 'subject' | null>(null),
    [uploads, setUploads] = useState<{ id: string; name: string; progress: number }[]>([]);
  const idRef = useRef<string | null>(draftId),
    initialized = useRef(false),
    savedJson = useRef(''),
    savePromise = useRef<Promise<Outbox> | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    pendingSchedule = useRef<string | undefined>(undefined);
  useComposingPresence(
    data.thread_id,
    ready &&
      ['reply', 'reply_all'].includes(data.kind) &&
      can(boxes.data?.find((b) => b.id === data.mailbox_id)?.role ?? null, 'send'),
  );
  const combined = {
    ...data,
    body_html: DOMPurify.sanitize(
      body +
        (data.signature_id
          ? `<div data-apmail-signature="${data.signature_id}">${signatureHtml}</div>`
          : '') +
        quote,
    ),
    attachments: files.map((f) => f.ref),
  };
  const current = useRef(combined);
  useEffect(() => {
    current.current = combined;
  });
  useEffect(() => {
    if (
      initialized.current ||
      !boxes.data ||
      !signatures.data ||
      (draftId && !draft.data) ||
      (replyId && !conversation.data)
    )
      return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled || initialized.current) return;
      initialized.current = true;
      let value = { ...blank(mailboxId), to_addresses: initialRecipient ? [initialRecipient] : [] },
        content = '';
      if (draft.data) {
        value = outboxSchema.parse(draft.data);
        const doc = new DOMParser().parseFromString(value.body_html, 'text/html');
        const sig = doc.querySelector('[data-apmail-signature]'),
          q = doc.querySelector('blockquote[data-apmail-quote]');
        if (sig) {
          setSignatureHtml(
            sig.innerHTML.trim() ||
              signatures.data.find((s) => s.id === value.signature_id)?.body_html ||
              '',
          );
          sig.remove();
        } else if (value.signature_id) {
          setSignatureHtml(
            signatures.data.find((s) => s.id === value.signature_id)?.body_html ?? '',
          );
        }
        if (q) {
          setQuote(q.outerHTML);
          q.remove();
        }
        content = doc.body.innerHTML;
        setFiles(
          value.attachments.map((ref) => {
            const id = ref.source === 'upload' ? ref.upload_id : ref.attachment_id;
            const meta = draft.data!.attachment_metadata?.find((a) => a.id === id);
            return {
              ref,
              filename: meta?.filename ?? 'Anexo indisponível',
              size_bytes: meta?.size_bytes ?? 0,
            };
          }),
        );
        savedJson.current = JSON.stringify(value);
        setSavedAt(
          new Intl.DateTimeFormat('pt-BR', {
            timeZone: me.data?.preferences.timezone ?? 'America/Sao_Paulo',
            timeZoneName: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(draft.data.updated_at)),
        );
      } else {
        const s =
          signatures.data.find((s) => s.is_default && s.mailbox_id === mailboxId) ??
          signatures.data.find((s) => s.is_default && !s.mailbox_id);
        if (s) {
          value.signature_id = s.id;
          setSignatureHtml(s.body_html);
        }
        if (replyId && conversation.data) {
          const m = conversation.data.messages.find((m) => m.id === replyId),
            box = boxes.data.find((b) => b.id === mailboxId);
          if (!m || !box) {
            setError('A mensagem original não está disponível.');
            return;
          }
          const kind = mode.split(':')[0] as ReplyKind,
            original = { ...m, reply_to: m.reply_to_addresses ?? [] } as ReplyMessage;
          value = {
            ...value,
            kind,
            thread_id: conversation.data.thread.id,
            reply_to_message_id: m.id,
            subject: replySubject(m.subject, kind),
            ...replyRecipients(original, kind, [box.email_address, ...box.aliases]),
          };
          setQuote(quoteHtml(original, kind, me.data?.preferences.timezone ?? 'America/Sao_Paulo'));
          setFiles(
            m.attachments
              .filter((a) => kind === 'forward' || a.is_inline)
              .map((a) => ({
                ref: { source: 'message_attachment', attachment_id: a.id },
                filename: a.filename,
                size_bytes: a.size_bytes,
              })),
          );
        }
      }
      setData(value);
      setBody(content);
      setCc(value.cc_addresses.length > 0);
      setBcc(value.bcc_addresses.length > 0);
      setReady(true);
    });
    return () => {
      canceled = true;
    };
  }, [
    boxes.data,
    signatures.data,
    draft.data,
    draftId,
    replyId,
    conversation.data,
    mailboxId,
    initialRecipient,
    mode,
    me.data,
  ]);
  const save = async (): Promise<Outbox> => {
    if (savePromise.current) {
      await savePromise.current;
      return save();
    }
    const value = outboxSchema.parse(current.current),
      json = JSON.stringify(value);
    if (idRef.current && json === savedJson.current) {
      return { ...value, id: idRef.current, status: 'draft' } as Outbox;
    }
    setSaving(true);
    const firstSave = !idRef.current;
    const promise = api<Outbox>(idRef.current ? '/outbox/' + idRef.current : '/outbox', {
      method: idRef.current ? 'PATCH' : 'POST',
      body: value,
    });
    savePromise.current = promise;
    try {
      const row = await promise;
      idRef.current = row.id;
      savedJson.current = json;
      if (firstSave) onReopen(row.id);
      setSavedAt(
        new Intl.DateTimeFormat('pt-BR', {
          timeZone: me.data?.preferences.timezone ?? 'America/Sao_Paulo',
          timeZoneName: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      );
      setError('');
      await client.invalidateQueries({ queryKey: ['outbox', tenant] });
      return row;
    } finally {
      savePromise.current = null;
      setSaving(false);
    }
  };
  const fingerprint = JSON.stringify(combined);
  useImperativeHandle(ref, () => ({
    saveDraft: async () => {
      if (uploads.length) throw Error('Aguarde o envio dos anexos.');
      if (ready && edited && JSON.stringify(current.current) !== savedJson.current) await save();
    },
  }));
  useEffect(() => {
    if (!ready || !edited || busy || uploads.length || fingerprint === savedJson.current) return;
    const timer = setTimeout(() => {
      void save().catch((e) => setError(e.message));
    }, 2000);
    return () => clearTimeout(timer);
  });
  const close = async () => {
    if (busy || uploads.length) return;
    setBusy(true);
    try {
      if (ready && edited && JSON.stringify(current.current) !== savedJson.current) await save();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const submit = async (scheduled_at?: string, subjectConfirmed = false) => {
    if (busy || uploads.length) return;
    try {
      const value = outboxSchema.parse(current.current);
      if (![...value.to_addresses, ...value.cc_addresses, ...value.bcc_addresses].length)
        throw Error('Informe ao menos um destinatário.');
      if (!value.subject.trim() && !subjectConfirmed) {
        pendingSchedule.current = scheduled_at;
        setConfirm('subject');
        return;
      }
      setBusy(true);
      const row = await save();
      await api('/outbox/' + row.id + '/submit', {
        method: 'POST',
        body: scheduled_at ? { scheduled_at } : {},
      });
      await client.invalidateQueries({ queryKey: ['outbox', tenant] });
      onClose();
      if (scheduled_at)
        toast.success(
          'Envio agendado para ' +
            new Date(scheduled_at).toLocaleString('pt-BR', {
              timeZone: me.data?.preferences.timezone,
              timeZoneName: 'short',
            }),
        );
      else
        toast.success('E-mail na fila de envio', {
          duration: 10000,
          action: {
            label: 'Desfazer',
            onClick: () => {
              void api('/outbox/' + row.id + '/cancel', { method: 'POST' })
                .then(() => {
                  onReopen(row.id);
                  void client.invalidateQueries({ queryKey: ['outbox', tenant] });
                })
                .catch((e) => toast.error(e.message));
            },
          },
        });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const upload = async (file: File, inline = false) => {
    if (
      inline &&
      (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024)
    )
      throw new Error('Use JPEG, PNG ou WebP de até 5 MB.');
    setEdited(true);
    const id = crypto.randomUUID();
    setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
    try {
      const response = await new Promise<{ id: string; filename: string; size_bytes: number }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            'POST',
            '/api/uploads?mailbox_id=' + encodeURIComponent(current.current.mailbox_id),
          );
          xhr.withCredentials = true;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setUploads((u) =>
                u.map((x) =>
                  x.id === id ? { ...x, progress: Math.round((e.loaded / e.total) * 100) } : x,
                ),
              );
          };
          xhr.onerror = () => reject(Error('Não foi possível enviar o anexo.'));
          xhr.onload = () => {
            let j;
            try {
              j = JSON.parse(xhr.responseText);
            } catch {
              reject(Error('Resposta inválida ao enviar anexo.'));
              return;
            }
            if (xhr.status >= 200 && xhr.status < 300) resolve(j);
            else reject(Error(j.error?.message ?? 'Não foi possível enviar o anexo.'));
          };
          const form = new FormData();
          form.append('file', file);
          xhr.send(form);
        },
      );
      setFiles((prev) => [
        ...prev,
        {
          ref: { source: 'upload', upload_id: response.id, ...(inline ? { inline: true } : {}) },
          filename: response.filename,
          size_bytes: response.size_bytes,
        },
      ]);
      return response.id;
    } catch (e) {
      setError((e as Error).message);
      if (inline) throw e;
    } finally {
      setUploads((u) => u.filter((x) => x.id !== id));
    }
  };
  const total = files.reduce((n, f) => n + f.size_bytes, 0),
    max = company.data?.settings.max_attachment_mb ?? 25;
  const readonly = !!draft.data && draft.data.status !== 'draft';
  return (
    <>
      {minimized && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border bg-card p-2 shadow-card">
          <Button variant="ghost" onClick={() => setMinimized(false)}>
            {data.subject || 'Restaurar rascunho'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fechar compositor"
            onClick={() => void close()}
          >
            <X />
          </Button>
        </div>
      )}
      <Dialog
        open={!minimized}
        modal={!desktop || maximized}
        onOpenChange={(v) => {
          if (!v) void close();
        }}
      >
        <DialogContent
          className={cn(
            'flex flex-col overflow-hidden',
            desktop && !maximized
              ? 'fixed bottom-4 right-4 left-auto top-auto h-[560px] max-h-[calc(100dvh-2rem)] w-[640px] max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 sm:max-w-[640px]'
              : 'fixed left-0 top-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none',
          )}
          onInteractOutside={(e) => {
            if (desktop && !maximized) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <DialogHeader className="shrink-0">
            {desktop && (
              <div className="mr-6 flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Minimizar compositor"
                  disabled={busy}
                  onClick={() => setMinimized(true)}
                >
                  <Minus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    maximized ? 'Restaurar tamanho do compositor' : 'Maximizar compositor'
                  }
                  onClick={() => setMaximized((v) => !v)}
                >
                  {maximized ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </div>
            )}
            <DialogTitle>
              {draftId
                ? 'Editar rascunho'
                : mode === 'new'
                  ? 'Novo e-mail'
                  : mode.startsWith('forward')
                    ? 'Encaminhar e-mail'
                    : 'Responder e-mail'}
            </DialogTitle>
            <DialogDescription>
              O rascunho é salvo automaticamente enquanto você escreve.
            </DialogDescription>
          </DialogHeader>
          {!ready ? (
            draft.error || conversation.error || boxes.error || signatures.error ? (
              <ErrorState
                onRetry={() => {
                  void draft.refetch();
                  void conversation.refetch();
                  void boxes.refetch();
                  void signatures.refetch();
                }}
              />
            ) : (
              <LoadingState />
            )
          ) : readonly ? (
            <p role="alert">Este envio já saiu dos rascunhos. Cancele antes de editar.</p>
          ) : (
            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) for (const f of e.dataTransfer.files) void upload(f);
              }}
            >
              <Label htmlFor="compose-from">De</Label>
              <select
                id="compose-from"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={data.mailbox_id}
                disabled={data.kind !== 'new' || busy || saving || uploads.length > 0}
                onChange={async (e) => {
                  const id = e.target.value;
                  if (busy || uploads.length || saving) return;
                  setBusy(true);
                  setError('');
                  try {
                    const row = await save();
                    const s =
                      signatures.data?.find((s) => s.is_default && s.mailbox_id === id) ??
                      signatures.data?.find((s) => s.is_default && !s.mailbox_id);
                    const next = {
                      ...current.current,
                      mailbox_id: id,
                      signature_id: s?.id ?? null,
                      body_html: DOMPurify.sanitize(
                        body +
                          (s
                            ? '<div data-apmail-signature="' + s.id + '">' + s.body_html + '</div>'
                            : '') +
                          quote,
                      ),
                    };
                    await api('/outbox/' + row.id, { method: 'PATCH', body: next });
                    savedJson.current = JSON.stringify(next);
                    current.current = next;
                    setData((d) => ({ ...d, mailbox_id: id, signature_id: s?.id ?? null }));
                    setSignatureHtml(s?.body_html ?? '');
                    setEdited(true);
                    await client.invalidateQueries({ queryKey: ['outbox', tenant] });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {boxes.data
                  ?.filter((b) => canMailbox(b, 'send') && b.status === 'active')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} &lt;{b.email_address}&gt;
                    </option>
                  ))}
              </select>
              <EmailChipInput
                label="Para"
                value={data.to_addresses}
                mailboxId={data.mailbox_id}
                onChange={(v) => {
                  setEdited(true);
                  setData((d) => ({ ...d, to_addresses: v }));
                }}
              />
              <div className="flex gap-2">
                {!cc && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCc(true)}>
                    Adicionar Cc
                  </Button>
                )}
                {!bcc && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setBcc(true)}>
                    Adicionar Cco
                  </Button>
                )}
              </div>
              {cc && (
                <EmailChipInput
                  label="Cc"
                  value={data.cc_addresses}
                  mailboxId={data.mailbox_id}
                  onChange={(v) => {
                    setEdited(true);
                    setData((d) => ({ ...d, cc_addresses: v }));
                  }}
                />
              )}
              {bcc && (
                <EmailChipInput
                  label="Cco"
                  value={data.bcc_addresses}
                  mailboxId={data.mailbox_id}
                  onChange={(v) => {
                    setEdited(true);
                    setData((d) => ({ ...d, bcc_addresses: v }));
                  }}
                />
              )}
              <Label htmlFor="compose-subject">Assunto</Label>
              <Input
                id="compose-subject"
                value={data.subject}
                onChange={(e) => {
                  const subject = e.target.value;
                  setEdited(true);
                  setData((d) => ({ ...d, subject }));
                }}
              />
              <Label>Mensagem</Label>
              <RichTextEditor
                value={body}
                onImageUpload={async (file) => {
                  const uploadId = await upload(file, true);
                  if (!uploadId) throw new Error('Não foi possível incorporar a imagem.');
                  return { src: `cid:${uploadId}@apmail.local`, uploadId };
                }}
                onChange={(value) => {
                  setEdited(true);
                  setBody(value);
                }}
              />
              <Label htmlFor="compose-signature">Assinatura</Label>
              <select
                id="compose-signature"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={data.signature_id ?? ''}
                onChange={(e) => {
                  const s = signatures.data?.find((s) => s.id === e.target.value);
                  setEdited(true);
                  setData((d) => ({ ...d, signature_id: s?.id ?? null }));
                  setSignatureHtml(s?.body_html ?? '');
                }}
              >
                <option value="">Sem assinatura</option>
                {signatures.data
                  ?.filter((s) => !s.mailbox_id || s.mailbox_id === data.mailbox_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              {data.signature_id && (
                <div
                  className="rounded-md border p-3 text-sm"
                  dangerouslySetInnerHTML={{ __html: signaturePreview(signatureHtml) }}
                />
              )}
              {quote && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Expandir mensagem citada"
                    aria-expanded={expandedQuote}
                    onClick={() => setExpandedQuote((v) => !v)}
                  >
                    …
                  </Button>
                  {expandedQuote && (
                    <div
                      className="max-h-60 overflow-auto rounded-md border p-3 text-sm"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(quote) }}
                    />
                  )}
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  for (const f of e.target.files ?? []) void upload(f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip />
                Adicionar anexos
              </Button>
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 break-all">
                      {f.filename} ({Math.ceil(f.size_bytes / 1024)} KB)
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Remover anexo ' + f.filename}
                      disabled={busy}
                      onClick={() => {
                        setEdited(true);
                        setFiles((prev) => prev.filter((_, j) => j !== i));
                        if (f.ref.source === 'upload' && f.ref.inline) {
                          const uploadId = f.ref.upload_id;
                          const document = new DOMParser().parseFromString(body, 'text/html');
                          document.querySelectorAll('img').forEach((image) => {
                            if (image.getAttribute('data-apmail-upload') === uploadId)
                              image.remove();
                          });
                          setBody(document.body.innerHTML);
                        }
                      }}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
                {uploads.map((u) => (
                  <li key={u.id} role="status" className="text-sm">
                    {u.name}: {u.progress}%
                    <progress
                      aria-label={'Envio de ' + u.name}
                      max={100}
                      value={u.progress}
                      className="w-full"
                    />
                  </li>
                ))}
              </ul>
              {total > max * 1024 * 1024 && (
                <p role="alert" className="text-sm text-destructive">
                  Os anexos excedem o limite de {max} MB.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div role="status" className="text-xs text-muted-foreground">
                {saving
                  ? 'Salvando…'
                  : savedAt
                    ? 'Salvo às ' + savedAt
                    : 'Rascunho ainda não salvo'}
              </div>
            </div>
          )}
          {ready && !readonly && (
            <div className="flex shrink-0 flex-wrap gap-2 border-t pt-3">
              <Button
                disabled={busy || !!uploads.length || total > max * 1024 * 1024}
                onClick={() => void submit()}
              >
                <Send />
                {busy ? 'Enviando…' : 'Enviar'}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!uploads.length || total > max * 1024 * 1024}
                onClick={() => setSchedule(true)}
              >
                <Clock />
                Agendar envio…
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !!uploads.length}
                onClick={() => setConfirm('discard')}
              >
                <Trash2 />
                Descartar
              </Button>
            </div>
          )}
          <ScheduleDialog
            open={schedule}
            onClose={() => setSchedule(false)}
            onSchedule={(v) => void submit(v)}
            timezone={me.data?.preferences.timezone ?? 'America/Sao_Paulo'}
            busy={busy}
          />
          <AlertDialog
            open={!!confirm}
            onOpenChange={(v) => {
              if (!v) setConfirm(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm === 'subject' ? 'Enviar sem assunto?' : 'Descartar rascunho?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === 'subject'
                    ? 'A mensagem será enviada com o assunto vazio.'
                    : 'O texto e os anexos deste rascunho serão removidos.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const action = confirm;
                    setConfirm(null);
                    if (action === 'subject') void submit(pendingSchedule.current, true);
                    else {
                      setBusy(true);
                      void (async () => {
                        if (savePromise.current) await savePromise.current;
                        if (idRef.current)
                          await api('/outbox/' + idRef.current, { method: 'DELETE' });
                        else
                          for (const f of files)
                            if (f.ref.source === 'upload')
                              await api('/uploads/' + f.ref.upload_id, { method: 'DELETE' });
                        await client.invalidateQueries({ queryKey: ['outbox', tenant] });
                        onClose();
                      })().catch((e) => {
                        setError(e.message);
                        setBusy(false);
                      });
                    }
                  }}
                >
                  {confirm === 'subject' ? 'Enviar sem assunto' : 'Descartar'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </>
  );
}
