import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AttachmentSafetyBadge } from './attachment-safety';
import { pendingSecurity } from '@/lib/antivirus';
it('communicates pending, clean and blocked files with text', () => {
  const { rerender } = render(<AttachmentSafetyBadge />);
  expect(screen.getByText('Verificação pendente')).toBeVisible();
  rerender(<AttachmentSafetyBadge security={{ ...pendingSecurity, status: 'clean' }} />);
  expect(screen.getByText('Verificado')).toBeVisible();
  rerender(
    <AttachmentSafetyBadge
      security={{ ...pendingSecurity, status: 'infected', threat_name: 'Heuristics.Encrypted.Zip' }}
    />,
  );
  expect(screen.getByText('Bloqueado por política')).toBeVisible();
});
