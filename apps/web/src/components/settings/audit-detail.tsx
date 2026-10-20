import { useQuery } from '@tanstack/react-query';
import { LockKeyhole, Mail, Paperclip } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import {
  actionLabel,
  entityLabels,
  fieldLabel,
  humanValue,
  record,
  type AuditEntry,
} from './audit-format';
export function AuditDetail({
  id,
  onClose,
  date,
}: {
  id: string | null;
  onClose: () => void;
  date: (s: string) => string;
}) {
  const tenant = useTenantId();
  const q = useQuery({
    queryKey: ['audit-detail', tenant, id],
    queryFn: () => api<AuditEntry>('/audit-logs/' + id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const entry = q.data,
    meta = entry?.metadata ?? {},
    mail = record(meta.message),
    box = record(meta.mailbox);
  const changeValues = (v: unknown) =>
    v === undefined
      ? {}
      : v !== null && typeof v === 'object' && !Array.isArray(v)
        ? record(v)
        : { [entry?.action.includes('status_changed') ? 'status' : 'value']: v };
  const before = changeValues(meta.before),
    after = changeValues(meta.after),
    changes = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const extras = Object.entries(meta).filter(
    ([k]) => !['before', 'after', 'mailbox', 'message', 'references'].includes(k),
  );
  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entry ? actionLabel(entry.action) : 'Detalhes da auditoria'}</DialogTitle>
          <DialogDescription>
            {entry
              ? `${entry.actor_name ?? 'Sistema / automação'} · ${date(entry.created_at)}`
              : 'Carregando o registro e suas informações.'}
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          entry && (
            <div className="space-y-5">
              <dl className="grid gap-4 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Responsável pela ação</dt>
                  <dd className="mt-1 font-medium">{entry.actor_name ?? 'Sistema / automação'}</dd>
                  {entry.actor_email && (
                    <dd className="mt-0.5 break-all text-xs text-muted-foreground">
                      {entry.actor_email}
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Registro</dt>
                  <dd className="mt-1">
                    {entityLabels[entry.entity_type] ?? fieldLabel(entry.entity_type)}
                  </dd>
                </div>
                {entry.ip && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Endereço IP</dt>
                    <dd className="mt-1 font-mono text-xs">{entry.ip}</dd>
                  </div>
                )}
                {!!box.name && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Caixa de e-mail</dt>
                    <dd className="mt-1">{String(box.name)}</dd>
                    <dd className="text-xs text-muted-foreground">
                      {String(box.email_address ?? '')}
                    </dd>
                  </div>
                )}
              </dl>
              {(entry.message_subject || Object.keys(mail).length > 0) && (
                <section className="space-y-3 rounded-lg border p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Mail className="size-4 text-primary" />
                    {entry.message_subject || '(sem assunto)'}
                  </h3>
                  <dl className="space-y-2 text-sm">
                    {['from_address', 'to', 'cc', 'bcc', 'reply_to_message_id', 'kind']
                      .filter(
                        (key) =>
                          mail[key] &&
                          (!Array.isArray(mail[key]) || (mail[key] as unknown[]).length),
                      )
                      .map((key) => (
                        <div className="grid gap-1 sm:grid-cols-[96px_1fr]" key={key}>
                          <dt className="text-muted-foreground">{fieldLabel(key)}</dt>
                          <dd className="break-words">{humanValue(mail[key])}</dd>
                        </div>
                      ))}
                  </dl>
                  {Array.isArray(mail.attachments) && mail.attachments.length > 0 && (
                    <div className="border-t pt-3">
                      <p className="mb-2 flex items-center gap-2 text-xs font-medium">
                        <Paperclip className="size-3.5" />
                        Anexos registrados
                      </p>
                      <ul className="space-y-1 text-sm">
                        {mail.attachments.map((a, i) => {
                          const f = record(a);
                          return (
                            <li key={i} className="break-words">
                              {String(f.filename)}{' '}
                              <span className="text-xs text-muted-foreground">
                                ({Math.ceil(Number(f.size_bytes) / 1024)} KB)
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              {changes.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">O que mudou</h3>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-xs">
                        <tr>
                          <th className="p-2">Campo</th>
                          <th className="p-2">Antes</th>
                          <th className="p-2">Depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((key) => (
                          <tr className="border-t align-top" key={key}>
                            <th className="p-2 text-left font-medium">{fieldLabel(key)}</th>
                            <td className="max-w-60 break-words p-2 text-muted-foreground">
                              {humanValue(before[key], record(meta.references))}
                            </td>
                            <td className="max-w-60 break-words p-2">
                              {humanValue(after[key], record(meta.references))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {extras.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Detalhes da operação</h3>
                  <dl className="divide-y rounded-lg border px-3">
                    {extras.map(([k, v]) => (
                      <div className="grid gap-1 py-2 text-sm sm:grid-cols-[180px_1fr]" key={k}>
                        <dt className="text-muted-foreground">{fieldLabel(k)}</dt>
                        <dd className="min-w-0 break-words">
                          {humanValue(v, record(meta.references))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {entry.has_content && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Conteúdo preservado da mensagem</h3>
                  {entry.can_read_content ? (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        Cópia em texto no momento da ação. Esta consulta também fica registrada na
                        auditoria.
                        {mail.content_truncated
                          ? ' Conteúdo limitado aos primeiros 200.000 caracteres.'
                          : ''}
                      </p>
                      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 font-sans text-sm leading-relaxed">
                        {entry.message_content || '(mensagem sem texto)'}
                      </pre>
                    </>
                  ) : (
                    <p className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                      <LockKeyhole className="size-4 shrink-0" />
                      Seu perfil permite consultar o histórico, mas não o conteúdo auditado dos
                      e-mails.
                    </p>
                  )}
                </section>
              )}
              {!entry.has_content && ['message', 'outbox'].includes(entry.entity_type) && (
                <p className="text-xs text-muted-foreground">
                  Este registro não possui uma cópia do texto. Registros históricos e solicitações
                  de envio podem conter somente os dados operacionais disponíveis.
                </p>
              )}
              <details className="border-t pt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer py-1">Identificadores para suporte</summary>
                <dl className="mt-2 space-y-2 break-all">
                  <div>
                    <dt>Registro de auditoria</dt>
                    <dd className="font-mono">{entry.id}</dd>
                  </div>
                  {entry.entity_id && (
                    <div>
                      <dt>Registro afetado</dt>
                      <dd className="font-mono">{entry.entity_id}</dd>
                    </div>
                  )}
                  {entry.request_id && (
                    <div>
                      <dt>Requisição</dt>
                      <dd className="font-mono">{entry.request_id}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
