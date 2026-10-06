import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';

it('invalida amostras antigas do provedor sem alterar capacidade APMail ou checkpoint', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin');
    // Temporary relation shadows the live QA table only on this connection.
    await client.query(
      'create temporary table mailbox_storage_limits (like public.mailbox_storage_limits including defaults) on commit drop',
    );
    await client.query(`insert into mailbox_storage_limits (mailbox_id,tenant_id,allocated_bytes,sync_checkpoint,paused_at,provider_status,provider_used_bytes,provider_limit_bytes,provider_identity,provider_checked_at)
      values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',100,'{"next_uid":42}', '2026-10-06T10:00:00Z','available',10,1000,'old',now())`);
    await client.query(
      await readFile(
        new URL('../../migrations/0019_provider_account_quota.sql', import.meta.url),
        'utf8',
      ),
    );
    const {
      rows: [row],
    } = await client.query('select * from mailbox_storage_limits');
    expect(row).toMatchObject({
      allocated_bytes: '100',
      sync_checkpoint: { next_uid: 42 },
      provider_status: 'pending',
      provider_used_bytes: null,
      provider_limit_bytes: null,
      provider_identity: null,
      provider_checked_at: null,
    });
    expect(row.paused_at.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
