import { expect, it } from 'vitest';
import { spellingWords } from './spelling-words';

it('mantém as posições do documento e ignora endereços, números e siglas', () => {
  const text =
    '😀 Olá, tijela e guarda-chuva. CPF 123 AB-123 cliente@empresa.com https://exemplo.com/site';
  const from = 17;
  const ranges = [...spellingWords({ text, from })];

  expect(ranges.map(({ word }) => word)).toEqual(['Olá', 'tijela', 'guarda-chuva']);
  for (const range of ranges) {
    expect(text.slice(range.from - from, range.to - from)).toBe(range.word);
  }
});
