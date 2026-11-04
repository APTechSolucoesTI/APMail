import { expect, it } from 'vitest';
import { mailSearchTerms } from './mail-search-date.js';

it('separa data válida do texto e preserva a busca textual quando a data é inválida', () => {
  expect(mailSearchTerms('orçamento 29/02/2024')).toEqual({
    text: 'orçamento',
    from: '2024-02-29',
    until: '2024-03-01',
  });
  expect(mailSearchTerms('02/2026')).toEqual({ text: '', from: '2026-02-01', until: '2026-03-01' });
  expect(mailSearchTerms('2026')).toEqual({ text: '', from: '2026-01-01', until: '2027-01-01' });
  expect(mailSearchTerms('2026-12-31')).toEqual({
    text: '',
    from: '2026-12-31',
    until: '2027-01-01',
  });
  expect(mailSearchTerms('orçamento 29/02/2026')).toEqual({ text: 'orçamento 29/02/2026' });
  expect(mailSearchTerms('pedido 1234')).toEqual({ text: 'pedido 1234' });
});
