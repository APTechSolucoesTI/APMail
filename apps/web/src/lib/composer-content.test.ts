import { expect, it } from 'vitest';
import { replaceComposerSignature } from './composer-content';
const one = '123e4567-e89b-42d3-a456-426614174000';
const two = '123e4567-e89b-42d3-a456-426614174001';
it('replaces only the current signature and preserves typed text', () => {
  const body = `<p>Minha mensagem</p><div data-apmail-signature="${one}"><p>Assinatura editada</p></div>`;
  const result = replaceComposerSignature(body, { id: two, body_html: '<p>Nova assinatura</p>' });
  expect(result).toContain('Minha mensagem');
  expect(result).toContain('Nova assinatura');
  expect(result).not.toContain('Assinatura editada');
  expect(replaceComposerSignature(result, null)).toBe('<p>Minha mensagem</p>');
});
it('keeps an intentionally cleared signature empty instead of restoring its template', () => {
  const result = replaceComposerSignature('<p>Texto</p>', { id: one, body_html: '' });
  expect(result).toContain(`data-apmail-signature="${one}"`);
  expect(result).not.toContain('undefined');
});
