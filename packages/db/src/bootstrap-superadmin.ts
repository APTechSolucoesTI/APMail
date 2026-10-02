import './config.js';
import { createDb } from './client.js';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.DATABASE_URL)
  throw new Error('Uso: pnpm --filter @apmail/db bootstrap:superadmin usuario@empresa.com');
const db = createDb(process.env.DATABASE_URL);
try {
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
  console.info('Super admin habilitado. Acesse /superadmin com a conta existente.');
} finally {
  await db.destroy();
}
