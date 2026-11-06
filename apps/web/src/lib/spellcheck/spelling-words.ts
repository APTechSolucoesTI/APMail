import type { SpellingRange, TextBlock } from './protocol';

const tokens =
  /(?:[a-z][\w+.-]{0,31}:\/\/|www\.)\S+|[^\s<>()@]{1,64}@[^\s<>()@]{1,253}|[\p{L}\p{M}\p{N}_]+(?:[-'’][\p{L}\p{M}\p{N}_]+)*/giu;

function greetingReplacement(word: string, text: string, index: number) {
  // The unaccented form is a noun. Suggest the greeting at the start of a sentence or line.
  if (word.toLowerCase() !== 'ola' || !/(?:^\s*|[.!?]\s+|\n\s*)$/u.test(text.slice(0, index)))
    return;
  return word === 'OLA' ? 'OLÁ' : 'Olá';
}

export function* spellingWords(block: TextBlock): Generator<SpellingRange> {
  for (const match of block.text.matchAll(tokens)) {
    const word = match[0];
    if (word.length < 2 || word.length > 48 || !/^[\p{L}\p{M}'’-]+$/u.test(word)) continue;
    const replacement = greetingReplacement(word, block.text, match.index);
    if (!replacement && /^[\p{Lu}]{2,5}$/u.test(word)) continue;
    const from = block.from + match.index;
    yield { word, from, to: from + word.length, replacement };
  }
}

function withoutAccents(word: string) {
  return word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

export function prioritizeSuggestions(word: string, suggestions: string[]) {
  const base = withoutAccents(word);
  const letters = base.split('');

  function priority(suggestion: string) {
    const candidate = withoutAccents(suggestion);
    if (candidate === base) return suggestion.toLowerCase() === word.toLowerCase() ? 2 : 0;
    if (candidate.length !== base.length) return 2;
    const first = letters.findIndex((letter, index) => letter !== candidate[index]);
    const second = first + 1;
    const swapped =
      letters[first] === candidate[second] &&
      letters[second] === candidate[first] &&
      base.slice(second + 1) === candidate.slice(second + 1);
    return swapped ? 1 : 2;
  }

  return [...suggestions].sort((left, right) => priority(left) - priority(right));
}
