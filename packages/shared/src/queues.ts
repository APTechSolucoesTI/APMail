export const QUEUE_NAMES = [
  'mailbox-sync',
  'mailbox-connection',
  'outbox-send',
  'mail-actions',
  'rules-apply',
  'system-email',
  'maintenance',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export type QueuePayloads = {
  'mailbox-sync': { mailbox_id: string };
  'mailbox-connection': { mailbox_id: string };
  'outbox-send': { outbox_id: string };
  'mail-actions': { action_id: string };
  'rules-apply': { rule_id: string; since_days: number };
  'system-email': { to: string; data: Record<string, string> };
  maintenance: Record<string, never>;
};
// BullMQ proíbe ':' em IDs personalizados; o contrato lógico permanece legível no banco.
export const toBullJobId = (logicalId: string): string => logicalId.replaceAll(':', '~');
// Redis Pub/Sub não isola bancos lógicos; o canal inclui o banco da conexão.
export const socketRedisKey = (redisUrl: string): string =>
  'apmail:socket:' + (redisUrl.match(/\/(\d+)(?:[?#]|$)/)?.[1] ?? '0');
export const platformAccessChannel = (redisUrl: string): string =>
  socketRedisKey(redisUrl) + ':platform-only';
