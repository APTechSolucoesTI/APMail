import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, beforeEach } from 'vitest';
import { listQuerySchema } from '@apmail/shared';
import { ConfigurableTable } from './configurable-table';
beforeEach(() => localStorage.clear());
const data = Array.from({ length: 35 }, (_, i) => ({
  id: String(i + 1),
  name: `Pessoa ${i + 1}`,
  email: `p${i + 1}@local`,
}));
function Fixture() {
  const [query, setQuery] = useState(listQuerySchema.parse({}));
  return (
    <ConfigurableTable
      listKey="teste"
      columns={[
        { id: 'name', header: 'Nome', hideable: false, sortable: true },
        { id: 'email', header: 'E-mail' },
      ]}
      data={data}
      query={query}
      onQueryChange={setQuery}
      mode="client"
      selectable
    />
  );
}
it('pagina, ordena em três estados e combina busca com paginação', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  expect(screen.getAllByText('1–10 de 35')).toHaveLength(2);
  await user.click(screen.getAllByRole('button', { name: 'Próxima página' })[0]!);
  expect(screen.getAllByText('11–20 de 35')).toHaveLength(2);
  const sort = screen.getByRole('button', { name: 'Nome' });
  await user.click(sort);
  expect(sort.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  await user.click(sort);
  expect(sort.closest('th')).toHaveAttribute('aria-sort', 'descending');
  await user.click(sort);
  expect(sort.closest('th')).toHaveAttribute('aria-sort', 'none');
  await user.type(screen.getByRole('searchbox'), 'Pessoa 35');
  await waitFor(() => expect(screen.getAllByText('1–1 de 1')).toHaveLength(2));
  await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
  await waitFor(() => expect(screen.getAllByText('1–10 de 35')).toHaveLength(2));
});
it('mantém rascunho de colunas até Aplicar e preserva identificação', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  await user.click(screen.getByRole('button', { name: 'Colunas' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('checkbox', { name: 'Nome' })).toBeDisabled();
  await user.click(within(dialog).getByRole('checkbox', { name: 'E-mail' }));
  await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Colunas' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'E-mail' }));
  await user.click(screen.getByRole('button', { name: 'Aplicar' }));
  expect(screen.queryByRole('columnheader', { name: 'E-mail' })).not.toBeInTheDocument();
});
it('marca seleção parcial como indeterminada', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  await user.click(screen.getByRole('checkbox', { name: 'Selecionar registro 1' }));
  expect(
    screen.getByRole('checkbox', { name: 'Selecionar itens da página atual' }),
  ).toHaveAttribute('aria-checked', 'mixed');
  expect(screen.getByText('1 selecionados na página atual')).toBeInTheDocument();
});
