import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Globe2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { administrativeSections } from '@/lib/admin';
import { PageHeader } from '@/components/layout/page-header';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import type { TenantQuota } from '@apmail/shared';
type Block = {
  state: 'ready' | 'error';
  message?: string;
  observed_at: string;
  data: Record<string, unknown>;
};
type Overview = { generated_at: string; sections: Record<string, Block> };
const definitions: { key: string; title: string; path: string; fields: [string, string][] }[] = [
  {
    key: 'domains',
    title: 'Domínios',
    path: '/admin/domains',
    fields: [
      ['total', 'Domínios cadastrados'],
      ['attention', 'Diagnósticos com atenção'],
      ['unchecked', 'Aguardando primeira consulta'],
    ],
  },
  {
    key: 'mailboxes',
    title: 'Conexão das caixas',
    path: '/admin/mailboxes',
    fields: [
      ['total', 'Caixas acessíveis'],
      ['active', 'Ativas'],
      ['error', 'Com falha de conexão'],
      ['local', 'Arquivos locais'],
    ],
  },
  {
    key: 'team',
    title: 'Equipe e acesso',
    path: '/admin/users',
    fields: [
      ['active', 'Membros ativos'],
      ['disabled', 'Desativados'],
      ['pending_invitations', 'Convites pendentes'],
    ],
  },
  {
    key: 'security',
    title: 'Segurança dos arquivos',
    path: '/admin/security/antivirus',
    fields: [
      ['blocked', 'Arquivos bloqueados'],
      ['pending', 'Aguardando análise'],
      ['error', 'Análises com erro'],
    ],
  },
];
export function AdminOverview() {
  const tenant = useTenantId(),
    me = useQuery(meQuery).data,
    q = useQuery({
      queryKey: ['admin-overview', tenant],
      queryFn: () => api<Overview>('/admin/overview'),
      refetchInterval: 60000,
    });
  const identity = me?.tenants.find((t) => t.id === tenant);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const s = q.data.sections,
    issues =
      s.mailboxes?.state === 'ready' && Array.isArray(s.mailboxes.data.issues)
        ? (s.mailboxes.data.issues as { id: string; label: string; href: string }[])
        : [];
  const attention = issues.length + Number(s.domains?.data?.attention ?? 0),
    storage = s.storage,
    policy = s.mail_policy;
  const activity =
    s.audit?.data && Array.isArray(s.audit.data.events)
      ? (s.audit.data.events as {
          id: string;
          action: string;
          actor_name: string | null;
          created_at: string;
        }[])
      : [];
  const provider = storage?.data?.provider as TenantQuota['provider'] | undefined;
  const bytes = (value: unknown) =>
    typeof value === 'string'
      ? (Number(value) / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' GB'
      : 'Não definido';
  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel Administrativo"
        description={
          'Visão geral de ' +
          (identity?.name ?? 'sua empresa') +
          ' · conexões, configurações e segurança.'
        }
        actions={
          <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={q.isFetching ? 'animate-spin' : ''} />
            Atualizar
          </Button>
        }
      />
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-5">
        <div className="flex items-start gap-3">
          {attention ? (
            <AlertTriangle className="mt-0.5 size-6 text-warning-fg" />
          ) : (
            <ShieldCheck className="mt-0.5 size-6 text-primary" />
          )}
          <div>
            <h2 className="text-lg font-semibold">
              {attention
                ? 'Há configurações que precisam de atenção'
                : 'Acompanhe a operação da sua empresa'}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {attention
                ? `${attention} pendência(s) observada(s) nas seções que você pode consultar.`
                : 'Consulte as informações disponíveis e os diagnósticos de cada área. Dados não consultados ainda não têm uma avaliação.'}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Atualizado às{' '}
          {new Date(q.data.generated_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </section>
      {issues.length > 0 && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-base font-semibold">Requer atenção</h2>
          {issues.map((i) => (
            <Link
              key={i.id}
              to={i.href}
              className="flex min-h-11 items-center justify-between gap-3 border-t py-3 text-sm"
            >
              <span>{i.label}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                Revisar conexão
                <ArrowUpRight className="size-4" />
              </span>
            </Link>
          ))}
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {definitions
          .filter((d) => s[d.key])
          .map((d) => {
            const b = s[d.key]!;
            return (
              <section key={d.key} className="rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b p-4">
                  <h2 className="text-base font-semibold">{d.title}</h2>
                  <Link to={d.path} className="inline-flex items-center gap-1 text-xs text-primary">
                    Gerenciar
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
                {b.state === 'error' ? (
                  <p role="alert" className="p-4 text-sm text-muted-foreground">
                    {b.message}
                  </p>
                ) : (
                  <dl className="divide-y px-4">
                    {d.fields.map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-3">
                        <dt className="text-sm text-muted-foreground">{label}</dt>
                        <dd
                          className={
                            'font-mono text-base font-semibold ' +
                            ((key === 'error' || key === 'attention' || key === 'blocked') &&
                            Number(b.data[key]) > 0
                              ? 'text-warning-fg'
                              : '')
                          }
                        >
                          {String(b.data[key] ?? '—')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            );
          })}
      </div>
      {(storage || policy) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {storage && (
            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold">Armazenamento APMail</h2>
              {storage.state === 'ready' ? (
                <>
                  <p className="my-3 text-2xl font-bold">
                    {bytes(storage.data.used_bytes)}{' '}
                    <span className="text-sm font-normal text-muted-foreground">utilizados</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Limite: {bytes(storage.data.storage_limit_bytes)}. Este consumo corresponde aos
                    dados armazenados no APMail.
                  </p>
                  <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Cotas informadas pelos provedores</p>
                    {provider && provider.known > 0 ? (
                      <p className="mt-1">
                        {bytes(provider.used_bytes)} de {bytes(provider.limit_bytes)} ·{' '}
                        {provider.known} de {provider.total} caixas IMAP consultadas.{' '}
                        {provider.known < provider.total ? 'Total parcial.' : ''}
                      </p>
                    ) : (
                      <p className="mt-1">
                        Sem cota individual disponível para as caixas consultadas.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="my-3 text-sm">{storage.message}</p>
              )}
              <Link
                to="/admin/company"
                className="mt-4 inline-flex items-center gap-1 text-sm text-primary"
              >
                Consultar armazenamento e cotas
                <ArrowUpRight className="size-4" />
              </Link>
            </section>
          )}
          {policy && (
            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold">Padrões de e-mail</h2>
              <p className="my-3 flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4 text-primary" />
                Filas de atendimento {policy.data?.enabled ? 'visíveis' : 'ocultas'}
              </p>
              <p className="text-xs text-muted-foreground">
                Defina como a equipe utiliza o atendimento. O Resumo das caixas de entrada é uma
                preferência de cada pessoa.
              </p>
              <Link
                to="/admin/company"
                className="mt-4 inline-flex items-center gap-1 text-sm text-primary"
              >
                Configurar padrões
                <ArrowUpRight className="size-4" />
              </Link>
            </section>
          )}
        </div>
      )}
      {s.audit && (
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Atividade administrativa recente</h2>
            <Link to="/admin/audit" className="text-xs text-primary">
              Abrir auditoria
            </Link>
          </div>
          {activity.length ? (
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-3 text-xs">
                  <span>
                    <span className="font-medium">{a.actor_name ?? 'Sistema'}</span> ·{' '}
                    {a.action.replaceAll('.', ' · ').replaceAll('_', ' ')}
                  </span>
                  <time className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString('pt-BR')}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              Nenhuma atividade disponível para o seu acesso.
            </p>
          )}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-base font-semibold">Acessos administrativos</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {administrativeSections(identity ?? {}).map((section) => (
            <Link
              key={section.path}
              to={section.path}
              className="rounded-lg border bg-card p-4 transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{section.label}</span>
                <ArrowUpRight className="size-4 text-primary" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{section.description}</p>
            </Link>
          ))}
        </div>
      </section>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Globe2 className="size-3.5" />
        Esta visão considera a empresa atual e suas permissões de acesso.
      </p>
    </div>
  );
}
