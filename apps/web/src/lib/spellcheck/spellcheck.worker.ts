import { Hunspell } from 'hunspell-wasm';
import initializeHunspell from 'hunspell-wasm/wasm/hunspell.js';
import wasmUrl from 'hunspell-wasm/wasm/hunspell.wasm?url';
import affixUrl from './dictionary/pt_BR.aff?url';
import dictionaryUrl from './dictionary/pt_BR.dic?url';
import type { SpellcheckRequest, SpellcheckResponse, SpellingRange } from './protocol';
import { spellingWords } from './spelling-words';

// The generated loader supports Emscripten's locateFile option, omitted by its declarations.
const initialize = initializeHunspell as (options: {
  locateFile: () => string;
}) => Promise<ConstructorParameters<typeof Hunspell>[0]>;

async function loadText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Dicionário indisponível');
  return response.text();
}

async function loadDictionary() {
  const [module, affixes, words] = await Promise.all([
    initialize({ locateFile: () => wasmUrl }),
    loadText(affixUrl),
    loadText(dictionaryUrl),
  ]);
  return new Hunspell(module, affixes, words);
}

let dictionary: Promise<Hunspell> | undefined;
let latestCheck = 0;
const knownWords = new Map<string, boolean>();

function respond(response: SpellcheckResponse) {
  self.postMessage(response);
}

self.addEventListener('message', async ({ data }: MessageEvent<SpellcheckRequest>) => {
  if (data.type === 'check') latestCheck = data.id;
  try {
    dictionary ??= loadDictionary();
    const spell = await dictionary;
    if (data.type === 'suggest') {
      const items = spell.getSpellingSuggestions(data.word.normalize('NFC')).slice(0, 6);
      respond({ type: 'suggestions', id: data.id, items });
      return;
    }
    if (data.id !== latestCheck) return;

    if (knownWords.size > 10_000) knownWords.clear();
    const ranges: SpellingRange[] = [];
    for (const block of data.blocks) {
      for (const range of spellingWords(block)) {
        const word = range.word.normalize('NFC');
        let correct = knownWords.get(word);
        if (correct === undefined) {
          correct = spell.testSpelling(word);
          knownWords.set(word, correct);
        }
        if (!correct) ranges.push(range);
      }
    }
    respond({ type: 'checked', id: data.id, ranges });
  } catch {
    respond({ type: 'unavailable' });
  }
});
