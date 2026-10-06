import { expect, it } from 'vitest';
import { canResumeQuota } from '../src/imap/quota-checkpoint.js';
it('reavalia pausa quando o limite muda ou bytes são liberados, sem perder precisão', () => {
  const checkpoint = {
    folder_id: 'folder',
    uidvalidity: '1',
    last_uid: 7,
    next_uid: 8,
    reason: 'quota',
    tenant_used: '9007199254740993',
    mailbox_used: '1000',
    tenant_limit: '9007199254740993',
    mailbox_limit: '1000',
  };
  const state = {
    checkpoint,
    tenant_used: checkpoint.tenant_used,
    mailbox_used: checkpoint.mailbox_used,
    tenant_limit: checkpoint.tenant_limit,
    mailbox_limit: checkpoint.mailbox_limit,
    provider_checked_at: null,
  };
  expect(canResumeQuota(state)).toBe(false);
  expect(canResumeQuota({ ...state, tenant_limit: '9007199254740994' })).toBe(true);
  expect(canResumeQuota({ ...state, tenant_limit: null })).toBe(true);
  expect(canResumeQuota({ ...state, mailbox_limit: '2000' })).toBe(true);
  expect(canResumeQuota({ ...state, tenant_used: '9007199254740992' })).toBe(true);
  expect(canResumeQuota({ ...state, mailbox_used: '999' })).toBe(true);
});
