import { AlertCircle, Inbox, LockKeyhole, SearchX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
export function LoadingState() {
  return (
    <div role="status" aria-label="Carregando dados" className="space-y-3 p-4">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
export function NoResultsState({ onClear, count = 1 }: { onClear: () => void; count?: number }) {
  return (
    <EmptyState
      icon={SearchX}
      title="Nenhum resultado"
      description="Ajuste a busca ou os filtros para encontrar o que procura."
      action={
        <Button variant="outline" onClick={onClear}>
          Limpar filtros ({count})
        </Button>
      }
    />
  );
}
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={AlertCircle}
      title="Não foi possível carregar os dados"
      description="Verifique sua conexão e tente novamente."
      action={
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      }
    />
  );
}
export function NoPermissionState() {
  return (
    <EmptyState
      icon={LockKeyhole}
      title="Sem permissão"
      description="Você não tem acesso a esta área. Fale com o administrador da empresa."
    />
  );
}
