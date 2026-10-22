import { z } from 'zod';

export const COMPOSITION_FONTS = [
  'Arial, sans-serif',
  'Aptos, Calibri, sans-serif',
  'Calibri, sans-serif',
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
  'Trebuchet MS, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  'Courier New, monospace',
] as const;
export const COMPOSITION_SIZES = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48,
] as const;
export const compositionFormatSchema = z.object({
  font_family: z.enum(COMPOSITION_FONTS),
  font_size: z.union(COMPOSITION_SIZES.map((size) => z.literal(size))),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Escolha uma cor válida.'),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  strike: z.boolean(),
});
export type CompositionFormat = z.infer<typeof compositionFormatSchema>;
export const DEFAULT_COMPOSITION_FORMAT: CompositionFormat = {
  font_family: 'Arial, sans-serif',
  font_size: 14,
  color: '#111827',
  bold: false,
  italic: false,
  underline: false,
  strike: false,
};
export type CompositionPreferences = {
  default_format: CompositionFormat;
  overrides: { mailbox_id: string; format: CompositionFormat }[];
};
export const compositionPreferenceSchema = z.object({
  mailbox_id: z.uuid().nullable(),
  format: compositionFormatSchema.nullable(),
});
export function resolveCompositionFormat(
  preferences: CompositionPreferences | undefined,
  mailboxId: string,
): CompositionFormat {
  return (
    preferences?.overrides.find((override) => override.mailbox_id === mailboxId)?.format ??
    preferences?.default_format ??
    DEFAULT_COMPOSITION_FORMAT
  );
}
