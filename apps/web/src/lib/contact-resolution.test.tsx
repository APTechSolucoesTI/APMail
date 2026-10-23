import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useContactResolution } from './contact-resolution';
import { api } from './api';

const access = vi.hoisted(() => ({ allowed: false }));
vi.mock('./auth', () => ({
  useTenantId: () => 'tenant',
  useUserId: () => 'user',
  useAccess: () => access.allowed,
}));
vi.mock('./api', () => ({ api: vi.fn(async () => ({ contacts: {} })) }));
function Probe() {
  const query = useContactResolution([' ANA@cliente.example ', 'ana@cliente.example']);
  return <p>{query.fetchStatus === 'idle' ? 'Pronto' : 'Consultando'}</p>;
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Probe />
    </QueryClientProvider>,
  );
}
it('does not request contact data when the profile only permits email', async () => {
  access.allowed = false;
  vi.mocked(api).mockClear();
  mount();
  await screen.findByText('Pronto');
  expect(api).not.toHaveBeenCalled();
});
it('resolves registered senders in one normalized batch when contact consultation is allowed', async () => {
  access.allowed = true;
  vi.mocked(api).mockClear();
  mount();
  await screen.findByText('Pronto');
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith(
    '/contacts/resolve',
    expect.objectContaining({ body: { emails: ['ana@cliente.example'] } }),
  );
});
