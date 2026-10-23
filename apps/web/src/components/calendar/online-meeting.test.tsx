import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { meetPreferencesSchema, type MeetIntegrationStatus } from '@apmail/shared';
import { api, ApiError } from '@/lib/api';
import { OnlineMeeting } from './online-meeting';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));
const status: MeetIntegrationStatus = {
  configured: true,
  redirect_uri: 'http://localhost/api/integrations/google/callback',
  connected: true,
  email: 'owner@qa.example',
  meet: true,
  calendar: false,
  scopes: [],
  preferences: meetPreferencesSchema.parse({}),
  capabilities: {},
  last_check: null,
  last_sync: null,
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
it.each([
  ['google_meeting_rejected', true],
  ['google_timeout', false],
  ['google_error', false],
  ['network_error', false],
])('renova solicitação apenas após rejeição definitiva: %s', async (code, renew) => {
  const submitted: string[] = [];
  const onChange = vi.fn();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/integrations/google') return status;
    if (path !== '/integrations/google/meet') throw new Error('Unexpected API path: ' + path);
    const body = options?.body as { request_id: string };
    submitted.push(body.request_id);
    if (submitted.length === 1) throw new ApiError(502, code, 'Falha controlada');
    return { meeting_url: 'https://meet.google.com/abc-defg-hij' };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <OnlineMeeting value={null} onChange={onChange} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const button = await screen.findByRole('button', { name: 'Adicionar Meet' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha controlada');
  fireEvent.click(button);
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith('https://meet.google.com/abc-defg-hij'),
  );
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toMatch(/^[a-f\d-]{36}$/);
  expect(submitted[0] === submitted[1]).toBe(!renew);
});
