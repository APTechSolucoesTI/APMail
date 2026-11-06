import type { SpellingRange, TextBlock } from './protocol';

const tokens =
  /(?:[a-z][\w+.-]{0,31}:\/\/|www\.)\S+|[^\s<>()@]{1,64}@[^\s<>()@]{1,253}|[\p{L}\p{M}\p{N}_]+(?:[-'’][\p{L}\p{M}\p{N}_]+)*/giu;

export function* spellingWords(block: TextBlock): Generator<SpellingRange> {
  for (const match of block.text.matchAll(tokens)) {
    const word = match[0];
    if (
      word.length < 2 ||
      word.length > 48 ||
      !/^[\p{L}\p{M}'’-]+$/u.test(word) ||
      /^[\p{Lu}]{2,5}$/u.test(word)
    ) {
      continue;
    }
    const from = block.from + match.index;
    yield { word, from, to: from + word.length };
  }
}
