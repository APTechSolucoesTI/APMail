export function renderFromName(
  template: string,
  values: { user_name: string; mailbox_name: string; tenant_name: string },
): string {
  return template
    .replace(
      /\{(user_name|mailbox_name|tenant_name)\}/g,
      (_, key: keyof typeof values) => values[key],
    )
    .replace(/["\r\n]/g, '')
    .slice(0, 100);
}
