export function queuesEnabled(settings: unknown): boolean {
  return !(
    settings &&
    typeof settings === 'object' &&
    'mail_queues_enabled' in settings &&
    settings.mail_queues_enabled === false
  );
}
export type TenantQueueRefreshJob = { tenant_id: string; generation: string };
