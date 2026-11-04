import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useAccess, useTenantId } from '@/lib/auth';
import { isTenantAdmin } from '@apmail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState, ErrorState } from '@/components/data/data-state';

const presets = [7, 15, 30, 60, 90];
export function MailRetentionPolicy() {
  const tenant = useTenantId();
  const me = useQuery(meQuery).data;
  const admin = isTenantAdmin(me?.tenants.find((item) => item.id === tenant)?.role);
  const mayManage = useAccess('retention.manage');
  const policy = useQuery({
    queryKey: ['mail-retention-policy', tenant],
    queryFn: () => api<{ days: number }>('/mail-retention/policy'),
    enabled: admin,
  });
  if (!admin) return null;
  return (
    <section className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
      <div>
        <h2 className="text-base font-semibold">Política de retenção de e-mails excluídos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O prazo começa quando o e-mail sai da Lixeira. Alterações valem para as próximas
          exclusões.
        </p>
        {mayManage && (
          <Button variant="link" asChild className="mt-2 h-auto p-0">
            <Link to="/admin/mail-retention">Consultar e-mails em retenção</Link>
          </Button>
        )}
      </div>
      {policy.isPending ? (
        <LoadingState />
      ) : policy.isError ? (
        <ErrorState onRetry={() => void policy.refetch()} />
      ) : (
        <PolicyForm key={tenant + ':' + policy.data.days} days={policy.data.days} />
      )}
    </section>
  );
}

function PolicyForm({ days }: { days: number }) {
  const tenant = useTenantId();
  const client = useQueryClient();
  const [option, setOption] = useState(presets.includes(days) ? String(days) : 'custom');
  const [custom, setCustom] = useState(String(days));
  const save = useMutation({
    mutationFn: (value: number) =>
      api<{ days: number }>('/mail-retention/policy', { method: 'PATCH', body: { days: value } }),
    onSuccess: (data) => {
      client.setQueryData(['mail-retention-policy', tenant], data);
      toast.success('Política de retenção atualizada.');
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(Number(option === 'custom' ? custom : option));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="retention-period">Período de retenção</Label>
        <select
          id="retention-period"
          value={option}
          disabled={save.isPending}
          onChange={(event) => setOption(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          {presets.map((value) => (
            <option key={value} value={value}>
              {value} dias
            </option>
          ))}
          <option value="custom">Período personalizado</option>
        </select>
      </div>
      {option === 'custom' && (
        <div className="space-y-1.5">
          <Label htmlFor="retention-custom">Quantidade de dias</Label>
          <Input
            id="retention-custom"
            type="number"
            min={1}
            max={3650}
            step={1}
            required
            value={custom}
            disabled={save.isPending}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Salvando…' : 'Salvar retenção'}
      </Button>
    </form>
  );
}
