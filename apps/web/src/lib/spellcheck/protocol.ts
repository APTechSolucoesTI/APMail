export type TextBlock = { from: number; text: string };
export type SpellingRange = { from: number; to: number; word: string; replacement?: string };

export type SpellcheckRequest =
  | { type: 'check'; id: number; blocks: TextBlock[] }
  | { type: 'suggest'; id: number; word: string };

export type SpellcheckResponse =
  | { type: 'checked'; id: number; ranges: SpellingRange[] }
  | { type: 'suggestions'; id: number; items: string[] }
  | { type: 'unavailable' };
