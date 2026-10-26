import { useQueries, useQuery } from '@tanstack/react-query';
import { Download, Eye, Paperclip, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import { useTenantId } from '@/lib/auth';
import {
  attachmentSecurityQuery,
  resolvedAttachmentSecurity,
  attachmentCanOpen,
  antivirusStatusLabel,
  antivirusExplanation,
  type AttachmentSecurity,
} from '@/lib/antivirus';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import type { Attachment } from '@/lib/mail';
import { EmailBodyFrame } from './email-body-frame';

export function SecuredEmailBody({
  attachments,
  cidMap,
  ...body
}: {
  attachments: Attachment[];
  html: string;
  cidMap: Record<string, string>;
  loadRemoteImages: boolean;
}) {
  const tenant = useTenantId();
  const queries = useQueries({
    queries: attachments.map((attachment) =>
      attachmentSecurityQuery(tenant, 'attachment', attachment.id, attachment.security),
    ),
  });
  const safeMap = { ...cidMap };
  let blocked = 0;
  attachments.forEach((attachment, index) => {
    if (!attachment.content_id) return;
    delete safeMap[attachment.content_id];
    const security = resolvedAttachmentSecurity(attachment.security, queries[index]?.data);
    if (attachmentCanOpen(security)) safeMap[attachment.content_id] = attachment.id;
    else blocked++;
  });
  return (
    <>
      {blocked > 0 && (
        <p role="status" className="text-xs text-warning-fg">
          {blocked} imagem(ns) incorporada(s) aguardam liberação pelo antivírus.
        </p>
      )}
      <EmailBodyFrame {...body} cidMap={safeMap} />
    </>
  );
}

export function AttachmentSafetyBadge({ security }: { security?: AttachmentSecurity | null }) {
  const status = security?.status ?? 'pending';
  return (
    <span title={antivirusExplanation(security)}>
      <StatusBadge
        label={antivirusStatusLabel(security)}
        variant={status === 'clean' ? 'success' : status === 'infected' ? 'danger' : 'warning'}
        icon={status === 'clean' ? ShieldCheck : status === 'pending' ? Clock : ShieldAlert}
      />
    </span>
  );
}

export function ReceivedAttachment({
  attachment,
  onPreview,
}: {
  attachment: Attachment;
  onPreview: (attachment: Attachment) => void;
}) {
  const tenant = useTenantId();
  const query = useQuery(
    attachmentSecurityQuery(tenant, 'attachment', attachment.id, attachment.security),
  );
  const security = resolvedAttachmentSecurity(attachment.security, query.data);
  const clean = attachmentCanOpen(security);
  return (
    <li className="flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted/50 p-2">
      <Paperclip className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs font-medium" title={attachment.filename}>
          {attachment.filename}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {Math.ceil(attachment.size_bytes / 1024)} KB
          </span>
          <AttachmentSafetyBadge security={security} />
        </div>
        {!clean && (
          <p className="max-w-80 text-xs text-muted-foreground" role="status">
            {antivirusExplanation(security)}
          </p>
        )}
      </div>
      {clean && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(attachment.content_type) && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={'Visualizar ' + attachment.filename}
          onClick={() => onPreview({ ...attachment, security })}
        >
          <Eye />
        </Button>
      )}
      {clean && (
        <Button variant="ghost" size="icon-sm" asChild>
          <a
            href={'/api/attachments/' + attachment.id + '/download'}
            aria-label={'Baixar ' + attachment.filename}
          >
            <Download />
          </a>
        </Button>
      )}
    </li>
  );
}
