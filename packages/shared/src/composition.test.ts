import { expect, it } from 'vitest';
import {
  compositionFormatSchema,
  DEFAULT_COMPOSITION_FORMAT,
  resolveCompositionFormat,
} from './composition.js';

it('resolves the personal default and only the selected mailbox override', () => {
  const personal = { ...DEFAULT_COMPOSITION_FORMAT, color: '#123456' };
  const special = { ...personal, bold: true };
  expect(
    resolveCompositionFormat(
      { default_format: personal, overrides: [{ mailbox_id: 'one', format: special }] },
      'two',
    ),
  ).toEqual(personal);
  expect(
    resolveCompositionFormat(
      { default_format: personal, overrides: [{ mailbox_id: 'one', format: special }] },
      'one',
    ),
  ).toEqual(special);
  expect(resolveCompositionFormat(undefined, 'one')).toEqual(DEFAULT_COMPOSITION_FORMAT);
});
it('accepts supported fonts and rejects unsafe styles and unsupported sizes', () => {
  expect(compositionFormatSchema.safeParse(DEFAULT_COMPOSITION_FORMAT).success).toBe(true);
  for (const patch of [
    { color: 'url(https://example.com)' },
    { font_family: 'arbitrary; background:red' },
    { font_size: 500 },
  ])
    expect(
      compositionFormatSchema.safeParse({ ...DEFAULT_COMPOSITION_FORMAT, ...patch }).success,
    ).toBe(false);
});
