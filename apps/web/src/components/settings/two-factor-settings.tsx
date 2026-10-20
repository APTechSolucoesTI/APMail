import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Shield, Copy, Download, Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { TwoFactorStatus, TwoFactorSetup } from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState, LoadingState } from '@/components/data/data-state';
import { TwoFactorForm } from '@/components/auth/two-factor-form';

export function TwoFactorSettings() {
  const client = useQueryClient();
  const userId = useQuery(meQuery).data?.user.id;
  const status = useQuery({
    queryKey: ['two-factor', userId],
    queryFn: () => api<TwoFactorStatus>('/auth/two-factor'),
    enabled: !!userId,
  });
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable' | 'recovery'>('idle');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['two-factor', userId] });
  }
  async function cancelSetup() {
    setCancelBusy(true);
    setCancelError('');
    try {
      await api('/auth/two-factor/setup', { method: 'DELETE' });
      setSetup(null);
      setMode('idle');
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancelBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }
  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob(
        [
          'APMail — códigos de recuperação\nGuarde em um lugar seguro. Cada código funciona uma única vez.\n\n' +
            codes.join('\n'),
        ],
        { type: 'text/plain;charset=utf-8' },
      ),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'apmail-codigos-recuperacao.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (status.isPending) return <LoadingState />;
  if (status.isError) return <ErrorState onRetry={() => void status.refetch()} />;
  return (
    <section
      aria-labelledby="two-factor-title"
      className="space-y-5 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-secondary p-2 text-primary">
            {status.data.enabled ? (
              <ShieldCheck className="size-5" />
            ) : (
              <Shield className="size-5" />
            )}
          </div>
          <div>
            <h2 id="two-factor-title" className="text-base font-semibold">
              Autenticação em dois fatores
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Proteja sua conta com um código adicional depois da senha.
            </p>
          </div>
        </div>
        <Badge variant="outline">{status.data.enabled ? 'Ativado' : 'Desativado'}</Badge>
      </div>
      {codes.length > 0 ? (
        <div className="space-y-4">
          <div className="rounded-md border bg-secondary/50 p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" />
              Guarde seus códigos de recuperação
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Eles são exibidos apenas agora. Use um deles se perder o acesso ao aplicativo. Cada
              código funciona uma única vez.
            </p>
          </div>
          <ul aria-label="Códigos de recuperação" className="grid gap-2 sm:grid-cols-2">
            {codes.map((code) => (
              <li
                key={code}
                className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all select-all"
              >
                {code}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copy(codes.join('\n'))}>
              <Copy />
              Copiar códigos
            </Button>
            <Button variant="outline" onClick={downloadCodes}>
              <Download />
              Baixar códigos
            </Button>
            <Button onClick={() => setCodes([])}>
              <Check />
              Já guardei os códigos
            </Button>
          </div>
        </div>
      ) : setup ? (
        <div className="space-y-5">
          <ol className="list-inside list-decimal space-y-2 text-sm">
            <li>No Google Authenticator, toque em adicionar e escolha ler um QR Code.</li>
            <li>Escaneie o código abaixo ou informe a chave manualmente.</li>
            <li>Digite o código do aplicativo para concluir a ativação.</li>
          </ol>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <img
              src={setup.qr_code}
              alt="QR Code para configurar sua conta APMail no aplicativo autenticador"
              width={224}
              height={224}
              className="size-56 shrink-0 self-center rounded-md border bg-white sm:self-start"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">Chave de configuração manual</p>
              <p className="rounded-md border bg-muted/50 p-3 font-mono text-sm break-all select-all">
                {setup.manual_key}
              </p>
              <Button variant="outline" size="sm" onClick={() => void copy(setup.manual_key)}>
                <Copy />
                Copiar chave
              </Button>
              <p className="text-xs text-muted-foreground">
                Configuração válida por 10 minutos. Não compartilhe esta chave nem o QR Code.
              </p>
            </div>
          </div>
          <TwoFactorForm
            key="enable"
            allowRecovery={false}
            submitLabel="Ativar 2FA"
            cancelLabel="Cancelar configuração"
            cancelPending={cancelBusy}
            onCancel={() => void cancelSetup()}
            onSubmit={async (b) => {
              const result = await api<{ recovery_codes: string[] }>('/auth/two-factor/enable', {
                method: 'POST',
                body: { code: b.code },
              });
              setCodes(result.recovery_codes);
              setSetup(null);
              setMode('idle');
              await refresh();
              toast.success('Autenticação em dois fatores ativada.');
            }}
          />
          {cancelError && (
            <p role="alert" className="text-sm text-destructive">
              {cancelError}
            </p>
          )}
        </div>
      ) : mode === 'setup' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Confirme sua senha atual para gerar uma chave de configuração exclusiva para sua conta.
          </p>
          <TwoFactorForm
            key="setup"
            password
            code={false}
            submitLabel="Gerar QR Code"
            onCancel={() => setMode('idle')}
            onSubmit={async (b) =>
              setSetup(
                await api<TwoFactorSetup>('/auth/two-factor/setup', {
                  method: 'POST',
                  body: { password: b.password },
                }),
              )
            }
          />
        </div>
      ) : mode === 'disable' || mode === 'recovery' ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">
            {mode === 'disable'
              ? 'Desativar a proteção em duas etapas'
              : 'Gerar novos códigos de recuperação'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {mode === 'disable'
              ? 'Depois de desativar, sua conta poderá ser acessada apenas com a senha.'
              : 'Os códigos anteriores deixarão de funcionar. Confirme sua identidade para substituí-los.'}
          </p>
          <TwoFactorForm
            key={mode}
            password
            destructive={mode === 'disable'}
            submitLabel={mode === 'disable' ? 'Desativar 2FA' : 'Gerar novos códigos'}
            onCancel={() => setMode('idle')}
            onSubmit={async (b) => {
              if (mode === 'disable') {
                await api('/auth/two-factor/disable', { method: 'POST', body: b });
                toast.success('Autenticação em dois fatores desativada.');
              } else {
                const result = await api<{ recovery_codes: string[] }>(
                  '/auth/two-factor/recovery-codes',
                  { method: 'POST', body: b },
                );
                setCodes(result.recovery_codes);
              }
              setMode('idle');
              await refresh();
            }}
          />
        </div>
      ) : status.data.enabled ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sua conta solicita um código do autenticador em cada novo login. Você tem{' '}
            {status.data.recovery_codes_remaining} códigos de recuperação disponíveis.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMode('recovery')}>
              Gerar novos códigos
            </Button>
            <Button variant="outline" onClick={() => setMode('disable')}>
              Desativar 2FA
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A ativação é opcional. Use o Google Authenticator ou outro aplicativo compatível. O 2FA
            protege esta conta em todas as empresas às quais você tem acesso.
          </p>
          <Button onClick={() => setMode('setup')}>
            <ShieldCheck />
            Configurar 2FA
          </Button>
        </div>
      )}
    </section>
  );
}
