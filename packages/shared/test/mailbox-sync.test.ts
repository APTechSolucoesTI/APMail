import { describe, expect, it } from 'vitest';
import { mailboxSchema, tenantSettingsSchema } from '../src/schemas/auth.js';
import { mailboxSyncSince } from '../src/mailbox-sync.js';

describe('período de importação IMAP', () => {
  it.each([30, 90, 180, 365, 1825, 3650, 0])(
    'aceita %i dias no cadastro e no padrão da empresa',
    (days) => {
      expect(mailboxSchema.shape.sync_days.parse(days)).toBe(days);
      expect(tenantSettingsSchema.parse({ default_sync_days: days }).default_sync_days).toBe(days);
    },
  );

  it('preserva o padrão de 90 dias e rejeita períodos inválidos', () => {
    expect(mailboxSchema.shape.sync_days.parse(undefined)).toBe(90);
    expect(mailboxSchema.shape.sync_days.safeParse(-1).success).toBe(false);
    expect(mailboxSchema.shape.sync_days.safeParse(10).success).toBe(false);
  });

  it('não aplica limite de data para todo o histórico', () => {
    expect(mailboxSyncSince(0)).toBeNull();
  });

  it.each([1825, 3650] as const)('calcula o corte de %i dias', (days) => {
    const before = Date.now() - days * 86400000;
    expect(mailboxSyncSince(days)!.getTime()).toBeGreaterThanOrEqual(before);
    expect(mailboxSyncSince(days)!.getTime()).toBeLessThanOrEqual(Date.now() - days * 86400000);
  });
});
