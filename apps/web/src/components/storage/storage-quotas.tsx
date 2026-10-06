import { useState, useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  storageAmountBytes,
  storageBytesAmount,
  storagePercentageBytes,
  storageUnits,
  tenantQuotaSchema,
  allocationSchema,
  type StorageUnit,
  type MailboxQuota,
  type TenantQuota,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { formatStorageBytes } from '@/lib/storage-metering';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingState, ErrorState } from '@/components/data/data-state';

const providerLabels = {
  pending: 'Aguardando consulta ao provedor',
  unsupported: 'O provedor não informa uma cota individual identificável para esta caixa',
  error: 'Não foi possível consultar a cota do provedor',
  available: '',
};
function defaultUnit(bytes: string | null): StorageUnit {
  const value = BigInt(bytes ?? 0);
  return (
    (['TB', 'GB', 'MB', 'KB'] as const).find((unit) => value >= storageUnits[unit]) ??
    (bytes === null ? 'GB' : 'B')
  );
}
function AmountUnit({
  value,
  onChange,
  label,
  percent = false,
}: {
  value: StorageUnit | '%';
  onChange: (v: StorageUnit | '%') => void;
  label: string;
  percent?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as StorageUnit | '%')}
      className="h-11 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
    >
      {percent && <option value="%">%</option>}
      {Object.keys(storageUnits).map((unit) => (
        <option key={unit} value={unit}>
          {unit}
        </option>
      ))}
    </select>
  );
}
export function StorageUsageBar({
  label,
  used,
  limit,
  unavailable,
  detail,
  hideLabel = false,
}: {
  label: string;
  used: string | null;
  limit: string | null;
  unavailable?: string;
  detail?: string;
  hideLabel?: boolean;
}) {
  const measured = used !== null,
    finite = limit !== null,
    cap = BigInt(limit ?? 0),
    consumed = BigInt(used ?? 0);
  const percent =
    finite && measured
      ? cap === 0n
        ? consumed > 0n
          ? 100
          : 0
        : Number((consumed * 10000n) / cap) / 100
      : null;
  const full = finite && measured && consumed >= cap;
  const text = !measured
    ? (unavailable ?? 'Informação indisponível')
    : `${formatStorageBytes(used)} / ${finite ? formatStorageBytes(limit) : 'Sem limite definido'}${percent === null ? '' : ` · ${percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`}`;
  return (
    <div className="min-w-0 space-y-2 text-card-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <span className={cn('font-semibold', hideLabel && 'sr-only')}>{label}</span>
        <span
          className="tabular-nums text-muted-foreground"
          title={measured ? `${used} bytes${finite ? ` de ${limit} bytes` : ''}` : undefined}
        >
          {text}
        </span>
      </div>
      {percent === null ? (
        <div className="h-2 rounded-full bg-muted" aria-hidden="true" />
      ) : (
        <progress
          className={cn('storage-quota-bar h-2 w-full text-primary', full && 'text-destructive')}
          max={100}
          value={Math.min(percent, 100)}
          aria-label={`${label}: ${text}`}
        />
      )}
      {full && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {consumed > cap ? 'Limite excedido' : 'Limite atingido'}
          {label.includes('APMail') ? ' · Novos conteúdos serão bloqueados.' : ''}
        </p>
      )}
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
export function MailboxQuotaBars({ quota }: { quota: MailboxQuota }) {
  return (
    <div className="space-y-3 text-card-foreground">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <StorageUsageBar
          label="Armazenamento APMail"
          used={quota.used_bytes}
          limit={quota.allocated_bytes}
        />
        <StorageUsageBar
          label="Armazenamento no provedor"
          used={quota.provider_status === 'available' ? quota.provider_used_bytes : null}
          limit={quota.provider_status === 'available' ? quota.provider_limit_bytes : null}
          unavailable={providerLabels[quota.provider_status]}
          detail={
            quota.provider_checked_at
              ? `Consulta: ${new Date(quota.provider_checked_at).toLocaleString('pt-BR')}`
              : undefined
          }
        />
      </div>
      {quota.paused_at && (
        <p role="status" className="flex items-start gap-2 rounded-md border p-3 text-xs">
          <PauseCircle className="size-4 shrink-0 text-primary" />
          <span>
            Sincronização pausada pela cota.{' '}
            {quota.sync_checkpoint
              ? `Próxima mensagem: UID ${quota.sync_checkpoint.next_uid}. `
              : ''}
            A importação retomará automaticamente quando houver capacidade.
          </span>
        </p>
      )}
    </div>
  );
}
export function quotaAlertLevel(used: string | null, limit: string | null) {
  if (used === null || limit === null) return null;
  const bytes = BigInt(used),
    cap = BigInt(limit);
  if (bytes >= cap) return 'full';
  return bytes * 100n >= cap * 90n ? 'near' : null;
}
export function MailboxStorageAlerts({ mailboxId }: { mailboxId: string }) {
  const tenant = useTenantId();
  const q = useQuery({
    queryKey: ['storage-quota', tenant, mailboxId],
    queryFn: ({ signal }) => api<MailboxQuota>(`/mailboxes/${mailboxId}/storage`, { signal }),
    refetchInterval: 60000,
  });
  if (!q.data) return null;
  const quota = q.data;
  const apmail = quotaAlertLevel(quota.used_bytes, quota.allocated_bytes);
  const provider =
    quota.provider_status === 'available'
      ? quotaAlertLevel(quota.provider_used_bytes, quota.provider_limit_bytes)
      : null;
  if (!apmail && !provider && !quota.paused_at) return null;
  return (
    <aside
      role="status"
      aria-label="Avisos de armazenamento"
      className="flex items-start gap-3 rounded-lg border bg-card p-3 text-card-foreground"
    >
      <AlertTriangle
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          (apmail === 'full' || provider === 'full') && 'text-destructive',
        )}
      />
      <div className="space-y-1 text-sm">
        {apmail && (
          <p>
            {apmail === 'full'
              ? 'Limite de armazenamento do APMail atingido. Novos conteúdos estão bloqueados.'
              : 'Armazenamento do APMail próximo do limite (90% ou mais). Solicite capacidade ou libere espaço.'}
          </p>
        )}
        {provider && (
          <p>
            {provider === 'full'
              ? 'Limite de armazenamento desta conta no provedor atingido.'
              : 'Armazenamento desta conta no provedor próximo do limite (90% ou mais).'}
          </p>
        )}
        {quota.paused_at && (
          <p>
            Sincronização pausada por falta de capacidade. Retomará automaticamente quando houver
            espaço.
          </p>
        )}
      </div>
    </aside>
  );
}
export function MailboxStorageCell({
  quota,
  provider = false,
  error = false,
}: {
  quota?: MailboxQuota;
  provider?: boolean;
  error?: boolean;
}) {
  if (!quota)
    return (
      <span className="text-xs text-muted-foreground">
        {error ? 'Não foi possível consultar o consumo' : 'Consultando consumo…'}
      </span>
    );
  return (
    <div className="min-w-0 whitespace-normal sm:w-48 sm:min-w-48">
      <StorageUsageBar
        label={provider ? 'Provedor' : 'APMail'}
        hideLabel
        used={
          provider
            ? quota.provider_status === 'available'
              ? quota.provider_used_bytes
              : null
            : quota.used_bytes
        }
        limit={
          provider
            ? quota.provider_status === 'available'
              ? quota.provider_limit_bytes
              : null
            : quota.allocated_bytes
        }
        unavailable={provider ? providerLabels[quota.provider_status] : undefined}
      />
      {!provider && quota.paused_at && (
        <p className="mt-2 text-xs text-muted-foreground">Sincronização pausada pela cota</p>
      )}
    </div>
  );
}
export function TenantStorage({
  tenantId,
  platform = false,
}: {
  tenantId: string;
  platform?: boolean;
}) {
  const q = useQuery({
    queryKey: ['storage-quota', platform ? 'platform' : 'tenant', tenantId],
    queryFn: ({ signal }) =>
      api<TenantQuota>(platform ? `/superadmin/tenants/${tenantId}/storage` : '/tenant/storage', {
        signal,
      }),
    refetchInterval: 60000,
  });
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  const data = q.data;
  return (
    <section className="space-y-6 rounded-lg border bg-card p-4 text-card-foreground">
      <div>
        <h2 className="text-xl font-semibold">Armazenamento e capacidade</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.mailboxes.length} caixas cadastradas ·{' '}
          {data.max_mailboxes === null
            ? 'Quantidade sem limite definido'
            : `Máximo de ${data.max_mailboxes} caixas`}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <StorageUsageBar
          label="Armazenamento APMail da empresa"
          used={data.used_bytes}
          limit={data.storage_limit_bytes}
          detail={`Inclui ${formatStorageBytes(data.shared_bytes)} de dados compartilhados e conteúdo retido até a limpeza física.`}
        />
        <StorageUsageBar
          label="Armazenamento nos provedores"
          used={data.provider.known ? data.provider.used_bytes : null}
          limit={data.provider.known ? data.provider.limit_bytes : null}
          unavailable="Nenhuma cota disponível nos provedores"
          detail={`${data.provider.known} de ${data.provider.total} caixas com cota informada${data.provider.known < data.provider.total ? ' · Total parcial' : ''}. Contas repetidas são contadas uma vez.`}
        />
      </div>
      {platform ? (
        <PlatformLimits
          key={JSON.stringify([data.max_mailboxes, data.storage_limit_bytes])}
          data={data}
        />
      ) : (
        <AllocationEditor
          key={JSON.stringify([
            data.storage_limit_bytes,
            data.allocation_mode,
            data.mailboxes.map((b) => [b.mailbox_id, b.allocated_bytes]),
          ])}
          data={data}
        />
      )}
      <div className="space-y-4">
        <h3 className="text-base font-semibold">Consumo por caixa</h3>
        {data.mailboxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            As caixas conectadas aparecerão aqui com as cotas do APMail e do provedor.
          </p>
        ) : (
          data.mailboxes.map((b) => (
            <article key={b.mailbox_id} className="space-y-3 rounded-lg border p-4">
              <div>
                <h4 className="break-words text-sm font-semibold">{b.name}</h4>
                <p className="break-all text-xs text-muted-foreground">{b.email_address}</p>
              </div>
              <MailboxQuotaBars quota={b} />
            </article>
          ))
        )}
      </div>
    </section>
  );
}
function PlatformLimits({ data }: { data: TenantQuota }) {
  const id = useId(),
    client = useQueryClient(),
    [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { isSubmitting },
  } = useForm<{ count: string; amount: string; unit: StorageUnit }>({
    defaultValues: {
      count: data.max_mailboxes === null ? '' : String(data.max_mailboxes),
      amount:
        data.storage_limit_bytes === null
          ? ''
          : storageBytesAmount(data.storage_limit_bytes, defaultUnit(data.storage_limit_bytes)),
      unit: defaultUnit(data.storage_limit_bytes),
    },
  });
  const unit = useWatch({ control, name: 'unit' });
  return (
    <form
      className="space-y-4 border-t pt-4"
      onSubmit={handleSubmit(async (b) => {
        setError('');
        try {
          const body = tenantQuotaSchema.parse({
            max_mailboxes: b.count.trim() === '' ? null : Number(b.count),
            storage_limit_bytes:
              b.amount.trim() === '' ? null : storageAmountBytes(b.amount, b.unit),
          });
          await api(`/superadmin/tenants/${data.tenant_id}/storage-limits`, {
            method: 'PUT',
            body,
          });
          await client.invalidateQueries({ queryKey: ['storage-quota'] });
          toast.success('Limites atualizados. As sincronizações pausadas serão reavaliadas.');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível salvar os limites.');
        }
      })}
    >
      <h3 className="text-base font-semibold">Limites definidos pela plataforma</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${id}-count`}>
            Máximo de caixas
          </label>
          <Input
            id={`${id}-count`}
            inputMode="numeric"
            type="number"
            min={0}
            max={100000}
            step={1}
            {...register('count')}
          />
          <p className="text-xs text-muted-foreground">
            Em branco: sem limite. Zero impede novas caixas.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${id}-amount`}>
            Limite de armazenamento da empresa
          </label>
          <div className="flex gap-2">
            <Input id={`${id}-amount`} inputMode="decimal" {...register('amount')} />
            <AmountUnit
              label="Unidade do limite da empresa"
              value={unit}
              onChange={(u) => {
                try {
                  const current = getValues();
                  if (current.amount.trim())
                    setValue(
                      'amount',
                      storageBytesAmount(
                        storageAmountBytes(current.amount, current.unit),
                        u as StorageUnit,
                      ),
                    );
                  setValue('unit', u as StorageUnit);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Em branco: sem limite. GB usa 1.000.000.000 bytes; GiB usa 1.073.741.824 bytes.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Reduzir a cota não exclui dados existentes. Conteúdos novos ficam bloqueados quando o
        consumo ultrapassar o limite. Na distribuição manual, as cotas das caixas precisam caber no
        novo total.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={isSubmitting}>{isSubmitting ? 'Salvando…' : 'Salvar limites'}</Button>
    </form>
  );
}
function AllocationEditor({ data }: { data: TenantQuota }) {
  const client = useQueryClient(),
    id = useId(),
    [mode, setMode] = useState(data.allocation_mode),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, { amount: string; unit: StorageUnit | '%' }>>(
    () =>
      Object.fromEntries(
        data.mailboxes.map((b) => [
          b.mailbox_id,
          {
            amount: storageBytesAmount(
              b.allocated_bytes ?? '0',
              defaultUnit(data.storage_limit_bytes),
            ),
            unit: defaultUnit(data.storage_limit_bytes),
          },
        ]),
      ),
  );
  let allocations: { mailbox_id: string; bytes: string }[] = [],
    validation = '';
  try {
    allocations = data.mailboxes.map((b) => ({
      mailbox_id: b.mailbox_id,
      bytes:
        draft[b.mailbox_id]!.unit === '%'
          ? storagePercentageBytes(draft[b.mailbox_id]!.amount, data.storage_limit_bytes ?? '0')
          : storageAmountBytes(
              draft[b.mailbox_id]!.amount,
              draft[b.mailbox_id]!.unit as StorageUnit,
            ),
    }));
  } catch (e) {
    validation = (e as Error).message;
  }
  const sum = allocations.reduce((s, a) => s + BigInt(a.bytes), 0n),
    remaining = data.storage_limit_bytes === null ? null : BigInt(data.storage_limit_bytes) - sum;
  if (remaining !== null && remaining < 0n)
    validation = 'A soma das cotas ultrapassa o limite definido pelo superadmin.';
  return (
    <form
      className="space-y-4 border-t pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setError('');
        setPending(true);
        try {
          if (mode === 'manual' && validation) throw Error(validation);
          const body = allocationSchema.parse({
            mode,
            allocations: mode === 'manual' ? allocations : [],
          });
          await api('/tenant/storage-allocation', { method: 'PUT', body });
          await client.invalidateQueries({ queryKey: ['storage-quota'] });
          toast.success('Distribuição atualizada.');
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <h3 className="text-base font-semibold">Distribuição entre caixas</h3>
      <label htmlFor={`${id}-mode`} className="block text-sm font-medium">
        Forma de distribuição
      </label>
      <select
        id={`${id}-mode`}
        disabled={pending}
        className="h-11 max-w-full rounded-md border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        value={mode}
        onChange={(e) => setMode(e.target.value as typeof mode)}
      >
        <option value="equal">Automática e igual entre as caixas</option>
        <option value="manual" disabled={data.storage_limit_bytes === null}>
          Personalizada por caixa
        </option>
      </select>
      <p className="text-xs text-muted-foreground">
        Na distribuição automática, a cota é recalculada ao adicionar ou remover caixas. Na
        personalizada, novas caixas usam apenas a capacidade ainda não distribuída; sem saldo, será
        necessário redistribuir.
      </p>
      {mode === 'manual' && (
        <div className="space-y-3">
          {data.mailboxes.map((b) => {
            const value = draft[b.mailbox_id]!;
            return (
              <div key={b.mailbox_id} className="grid items-center gap-2 sm:grid-cols-2">
                <label htmlFor={`${id}-${b.mailbox_id}`} className="min-w-0 break-words text-sm">
                  {b.name}
                  <span className="block break-all text-xs text-muted-foreground">
                    {b.email_address}
                  </span>
                </label>
                <div className="flex min-w-0 gap-2">
                  <Input
                    disabled={pending}
                    id={`${id}-${b.mailbox_id}`}
                    aria-invalid={!!validation}
                    inputMode="decimal"
                    value={value.amount}
                    onChange={(e) =>
                      setDraft({ ...draft, [b.mailbox_id]: { ...value, amount: e.target.value } })
                    }
                  />
                  <AmountUnit
                    percent
                    label={`Unidade da cota de ${b.name}`}
                    value={value.unit}
                    onChange={(unit) => {
                      try {
                        const bytes =
                          value.unit === '%'
                            ? storagePercentageBytes(value.amount, data.storage_limit_bytes ?? '0')
                            : storageAmountBytes(value.amount, value.unit);
                        const percent =
                          data.storage_limit_bytes && BigInt(data.storage_limit_bytes) > 0n
                            ? (BigInt(bytes) * 1000000n) / BigInt(data.storage_limit_bytes)
                            : 0n;
                        const amount =
                          unit === '%'
                            ? `${percent / 10000n}.${(percent % 10000n).toString().padStart(4, '0')}`
                            : storageBytesAmount(bytes, unit);
                        setDraft({ ...draft, [b.mailbox_id]: { amount, unit } });
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-sm tabular-nums">
            Total distribuído: {formatStorageBytes(sum.toString())} · Disponível:{' '}
            {formatStorageBytes(remaining?.toString())}
          </p>
        </div>
      )}
      {(error || (mode === 'manual' && validation)) && (
        <p role="alert" className="text-sm text-destructive">
          {error || validation}
        </p>
      )}
      <Button
        disabled={
          pending || (mode === 'manual' && (!!validation || data.storage_limit_bytes === null))
        }
      >
        {pending ? 'Salvando…' : 'Salvar distribuição'}
      </Button>
    </form>
  );
}
