import './config.js';
import { createDb } from './client.js';
import { Redis } from 'ioredis';
import { platformAccessChannel } from '@apmail/shared';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error('Uso: pnpm --filter @apmail/db bootstrap:superadmin usuario@empresa.com');
const db = createDb(process.env.DATABASE_URL);
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on('error', () => undefined);
try {
  // Ensure the revocation signal can reach all API instances before granting the role.
  await redis.ping();
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  if (!user) throw new Error('Crie primeiro a conta pela aplicação.');
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('platform_admins')
      .values({ user_id: user.id })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
    await tx
      .insertInto('platform_audit')
      .values({ actor_id: user.id, action: 'platform.admin_bootstrapped' })
      .execute();
  });
  await redis.publish(platformAccessChannel(process.env.REDIS_URL), user.id);
  console.info(
    'Superadmin habilitado. Acesse /superadmin. Esta conta não acessa caixas de entrada; use outra conta para administrar e-mails da empresa.',
  );
} finally {
  await Promise.all([db.destroy(), redis.quit()]);
}
