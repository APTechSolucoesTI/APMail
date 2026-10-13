/** PostgreSQL text/JSON cannot contain NUL. Keep raw MIME and binary attachments intact. */
export function mailText(value: string): string {
  return value.replaceAll('\u0000', '\uFFFD');
}
