import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { MailboxQuota } from '@apmail/shared';
import { MailboxStorageAlerts, MailboxStorageCell, quotaAlertLevel } from './storage-quotas';

vi.mock('@/lib/auth', () => ({ useTenantId: () => 'tenant' }));
const quota: MailboxQuota = {
  mailbox_id: 'box',
  tenant_id: 'tenant',
  name: 'Teste',
  email_address: 'qa@local.test',
  used_bytes: '89',
  allocated_bytes: '100',
  paused_at: null,
  sync_checkpoint: null,
  provider_status: 'available',
  provider_used_bytes: '50',
  provider_limit_bytes: '100',
  provider_checked_at: null,
};
function alerts(value: MailboxQuota) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['storage-quota', 'tenant', 'box'], value);
  return render(
    <QueryClientProvider client={client}>
      <MailboxStorageAlerts mailboxId="box" />
    </QueryClientProvider>,
  );
}
it('avisa a partir de 90%, incluindo capacidade zero e valores acima da precisão de Number', () => {
  expect(quotaAlertLevel('89', '100')).toBeNull();
  expect(quotaAlertLevel('90', '100')).toBe('near');
  expect(quotaAlertLevel('100', '100')).toBe('full');
  expect(quotaAlertLevel('0', '0')).toBe('full');
  expect(quotaAlertLevel('90', null)).toBeNull();
  expect(quotaAlertLevel(null, '100')).toBeNull();
  expect(quotaAlertLevel('9007199254740993', '10007999171934437')).toBeNull();
  expect(quotaAlertLevel('9007199254740994', '10007999171934437')).toBe('near');
});
it('não ocupa espaço na tela de emails nem mostra barras abaixo do alerta', () => {
  const { container } = alerts(quota);
  expect(container).toBeEmptyDOMElement();
});
it('exibe somente avisos de limite ou pausa, ignorando amostra indisponível do provedor', () => {
  alerts({
    ...quota,
    provider_status: 'unsupported',
    provider_used_bytes: '100',
    paused_at: new Date().toISOString(),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Sincronização pausada');
  expect(screen.queryByText(/conta no provedor/)).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('avisa quando o provedor se aproxima do limite e mostra consumo apenas na célula de configuração', () => {
  alerts({ ...quota, provider_used_bytes: '95' });
  expect(screen.getByRole('status')).toHaveTextContent('no provedor próximo do limite');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  render(<MailboxStorageCell quota={quota} provider />);
  expect(screen.getByRole('progressbar')).toHaveAccessibleName(/Provedor/);
});
