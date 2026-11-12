import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { Route as ExternalRoute } from '@/routes/abrir-externo';
import { Route as LoginRoute } from '@/routes/login';
import { queryClient } from './query-client';

const id = 'aa034af6-fc6b-4e16-8f6e-a9630cfbdf5c';
const mailbox = '/mail/' + id + '?assigned=any';
const external = (link: string) => '/abrir-externo?u=' + encodeURIComponent(link);

afterEach(() => {
  cleanup();
  queryClient.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function launch(link: string, signedIn: boolean) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/auth/login') {
      signedIn = true;
      return Response.json({ requires_two_factor: false });
    }
    if (url === '/api/auth/me')
      return signedIn
        ? Response.json({})
        : Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
    if (url === '/api/messages/' + id + '/location')
      return Response.json({ path: mailbox + '&thread=' + id });
    throw new Error('Unexpected request: ' + url);
  });
  vi.stubGlobal('fetch', fetch);
  const root = createRootRoute();
  const history = createMemoryHistory({ initialEntries: [external(link)] });
  const router = createRouter({
    history,
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Início QA</p> }),
      createRoute({
        getParentRoute: () => root,
        path: '/mail/$mailboxId',
        component: () => <p>Caixa QA</p>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/abrir-externo',
        beforeLoad: ExternalRoute.options.beforeLoad,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/login',
        validateSearch: LoginRoute.options.validateSearch,
        component: LoginRoute.options.component,
      }),
    ]),
  });
  render(<RouterProvider router={router} />);
  return { history, fetch };
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@qa.test' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SenhaDeTeste123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

it('abre a caixa com o filtro original e substitui a rota de entrada no histórico', async () => {
  const { history } = launch('web+apmail://abrir?caminho=' + encodeURIComponent(mailbox), true);
  await screen.findByText('Caixa QA');
  expect(history.location.href).toBe(mailbox);
  expect(history.length).toBe(1);
});

it('só resolve a mensagem após o login e substitui a entrada e o login no histórico', async () => {
  const { history, fetch } = launch('web+apmail://mensagem/' + id, false);
  await waitFor(() => expect(history.location.href).toBe('/login?external=true'));
  expect(fetch).not.toHaveBeenCalledWith('/api/messages/' + id + '/location', expect.anything());
  await signIn();
  await screen.findByText('Caixa QA');
  expect(history.location.href).toBe(mailbox + '&thread=' + id);
  expect(history.length).toBe(1);
});

it('descarta um destino adulterado entre o link e o login', async () => {
  const { history } = launch('web+apmail://mensagem/' + id, false);
  await waitFor(() => expect(history.location.href).toBe('/login?external=true'));
  sessionStorage.setItem('apmail:external-launch', 'web+apmail://abrir?caminho=%2F%2Fsite.com');
  await signIn();
  await screen.findByText('Início QA');
  expect(history.location.href).toBe('/');
  expect(sessionStorage.getItem('apmail:external-launch')).toBeNull();
});
