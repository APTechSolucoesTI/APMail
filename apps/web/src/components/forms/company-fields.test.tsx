import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { companyDetailsSchema } from '@apmail/shared';
import { CompanyForm } from './company-fields';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const schema = z.object({ company_details: companyDetailsSchema });
it('automatically fills CNPJ registration, keeps fields editable and saves values', async () => {
  vi.mocked(api).mockResolvedValue({
    cnpj: '11222333000181',
    legal_name: 'Empresa consultada',
    city: 'São Paulo',
  });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <CompanyForm
      schema={schema}
      defaults={{ company_details: {} }}
      lookupPath="/tenant/company-lookup/"
      onSubmit={save}
    />,
  );
  fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-81' } });
  await waitFor(() =>
    expect(screen.getByLabelText('Razão social')).toHaveValue('Empresa consultada'),
  );
  fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Nome revisado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        company_details: expect.objectContaining({
          legal_name: 'Nome revisado',
          cnpj: '11222333000181',
          city: 'São Paulo',
        }),
      }),
    ),
  );
});
it('keeps manual entry available when lookup fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Consulta indisponível. Preencha manualmente.'));
  render(
    <CompanyForm
      schema={schema}
      defaults={{ company_details: {} }}
      lookupPath="/tenant/company-lookup/"
      onSubmit={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11222333000181' } });
  await screen.findByText('Consulta indisponível. Preencha manualmente.');
  expect(screen.getByLabelText('Razão social')).toBeEnabled();
});
it('ignores an obsolete lookup and removes its progress when the CNPJ changes', async () => {
  let resolve: (value: unknown) => void = () => {};
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <CompanyForm
      schema={schema}
      defaults={{ company_details: {} }}
      lookupPath="/tenant/company-lookup/"
      onSubmit={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11222333000181' } });
  await screen.findByText('Consultando cadastro…');
  fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '' } });
  await waitFor(() => expect(screen.queryByText('Consultando cadastro…')).not.toBeInTheDocument());
  resolve({ cnpj: '11222333000181', legal_name: 'Cadastro obsoleto' });
  await waitFor(() => expect(screen.getByLabelText('Razão social')).toHaveValue(''));
});
