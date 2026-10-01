import { expect, it } from 'vitest';
import { safeAuditMetadata } from '../src/domain/audit.js';
it('remove segredos e corpo de e-mail de metadados aninhados sem perder alterações operacionais', () => {
  expect(
    safeAuditMetadata({
      before: { name: 'Antes', password: 'secret', settings: { smtp_token: 'token', sla: 24 } },
      after: {
        name: 'Depois',
        roles: [{ role: 'editor', cookie: 'secret' }],
        body_html: 'private',
        encrypted_credentials: 'secret',
      },
    }),
  ).toEqual({
    before: { name: 'Antes', settings: { sla: 24 } },
    after: { name: 'Depois', roles: [{ role: 'editor' }] },
  });
});
