import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FileReleaseDialog } from './file-release-dialog';
import { api } from '@/lib/api';
import { pendingSecurity } from '@/lib/antivirus';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({ released: 1 });
});
function open(threat = 'Heuristics.Encrypted.PDF') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FileReleaseDialog
        targets={[
          {
            ...pendingSecurity,
            id: '00000000-0000-4000-8000-000000000001',
            status: 'infected',
            threat_name: threat,
            filename: 'documento.pdf',
            kind: 'attachment',
            sender: 'contato@qa.example',
            mailbox_id: '00000000-0000-4000-8000-000000000002',
          },
        ]}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
it('requires consent and preserves the original verdict when marking a possible false positive', async () => {
  open();
  fireEvent.change(screen.getByLabelText('Motivo da liberação'), {
    target: { value: 'Documento conhecido e origem conferida.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar anexo' }));
  await screen.findByText('Confirme a decisão de liberação.');
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/Confio na origem/));
  fireEvent.click(screen.getByLabelText(/Marcar como possível falso positivo/));
  fireEvent.click(screen.getByRole('button', { name: 'Liberar anexo' }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(vi.mocked(api).mock.calls[0]?.[1]?.body).toMatchObject({
    acknowledge_risk: true,
    false_positive: true,
  });
  expect(JSON.stringify(vi.mocked(api).mock.calls[0]?.[1]?.body)).not.toContain('"status":"clean"');
});
it('requires additional acknowledgement for malware and never offers automatic trust for it', async () => {
  open('Trojan.Encrypted.PDF');
  expect(screen.queryByText('Adicionar aos remetentes confiáveis')).toBeNull();
  fireEvent.change(screen.getByLabelText('Motivo da liberação'), {
    target: { value: 'Arquivo analisado de forma independente.' },
  });
  fireEvent.click(screen.getByLabelText(/Confio na origem/));
  fireEvent.click(screen.getByRole('button', { name: 'Liberar anexo' }));
  await screen.findByText('Confirme que está ciente da ameaça detectada.');
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/Estou ciente/));
  fireEvent.click(screen.getByRole('button', { name: 'Liberar anexo' }));
  await waitFor(() => expect(api).toHaveBeenCalled());
});
