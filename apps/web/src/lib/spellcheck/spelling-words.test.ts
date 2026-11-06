import { expect, it } from 'vitest';
import { prioritizeSuggestions, spellingWords } from './spelling-words';

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

it.each([
  ['ola', 'Olá'],
  ['Ola, tudo bem?', 'Olá'],
  ['OLA!', 'OLÁ'],
  ['Tudo bem? ola de novo.', 'Olá'],
  ['Tudo bem?\nola de novo.', 'Olá'],
])('sugere a saudação acentuada em %s', (text, replacement) => {
  expect([...spellingWords({ text, from: 4 })]).toContainEqual(
    expect.objectContaining({ replacement }),
  );
});

it.each(['A torcida fez uma ola.', 'Falei com Ola ontem.', 'Esta mensagem está certa.'])(
  'preserva as grafias válidas em %s',
  (text) => {
    expect([...spellingWords({ text, from: 0 })].some((range) => range.replacement)).toBe(false);
  },
);

it('prioriza o acento e a troca de letras vizinhas nas sugestões', () => {
  expect(prioritizeSuggestions('so', ['SO', 'só', 'sô', 'si'])).toEqual(['só', 'sô', 'SO', 'si']);
  expect(prioritizeSuggestions('portugeus', ['portuguesa', 'português', 'portugas'])).toEqual([
    'português',
    'portuguesa',
    'portugas',
  ]);
});
