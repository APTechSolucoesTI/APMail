import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Video, Copy, ExternalLink, X, Loader2 } from 'lucide-react';
import { googleMeetUrl } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
export type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  meet: boolean;
  calendar: boolean;
  redirect_uri: string;
};
export function OnlineMeeting({
  value,
  onChange,
  disabled,
  readonly,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  readonly?: boolean;
}) {
  const tenant = useTenantId(),
    google = useQuery({
      queryKey: ['google-integration', tenant],
      queryFn: () => api<GoogleStatus>('/integrations/google'),
      refetchOnWindowFocus: true,
    }),
    [busy, setBusy] = useState(false),
    [manual, setManual] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ meeting_url: string }>('/integrations/google/meet', {
        method: 'POST',
        body: { request_id: requestId },
      });
      onChange(result.meeting_url);
      toast.success('Link do Google Meet criado. Salve o evento para compartilhar.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Reunião online" className="rounded-lg border bg-secondary/30 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
          <Video className="size-4" />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-medium">Google Meet</p>
          <p className="truncate text-xs text-muted-foreground">
            {value
              ? value
              : google.data?.meet
                ? 'Criar uma sala com ' + google.data.email
                : 'Reunião online para os participantes'}
          </p>
        </div>
        {value ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Copiar link da reunião"
              onClick={() =>
                void navigator.clipboard
                  .writeText(value)
                  .then(() => toast.success('Link copiado.'))
                  .catch(() => toast.error('Não foi possível copiar o link.'))
              }
            >
              <Copy />
            </Button>
            <Button asChild type="button" size="sm">
              <a href={value} target="_blank" rel="noopener noreferrer">
                Entrar
                <ExternalLink />
              </a>
            </Button>
            {!readonly && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remover reunião online"
                disabled={disabled || busy}
                onClick={() => {
                  setRequestId(crypto.randomUUID());
                  onChange(null);
                }}
              >
                <X />
              </Button>
            )}
          </>
        ) : (
          !readonly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy || !google.data?.meet}
              onClick={() => void generate()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Video />}Adicionar Meet
            </Button>
          )
        )}
      </div>
      {!value && !readonly && (
        <div className="mt-2 pl-12 text-xs">
          {!google.data?.meet && (
            <p className="mb-2 text-muted-foreground">
              <Link
                to="/settings/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Conectar Google
              </Link>{' '}
              para criar reuniões automaticamente.
            </p>
          )}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => setManual(!manual)}
          >
            Usar um link existente
          </button>
          {manual && (
            <div className="mt-2">
              <label className="space-y-1">
                Link da reunião
                <Input
                  aria-label="Link da reunião"
                  type="url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  disabled={disabled}
                  onBlur={(e) => {
                    if (!e.target.value) return;
                    const url = googleMeetUrl(e.target.value);
                    if (url) {
                      onChange(url);
                      setError('');
                    } else setError('Cole o link válido gerado pelo Google Meet.');
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
