import { createDb, loadRootEnv, writeMailboxCredential } from '../packages/db/src/index.js';
import { hashPassword } from '../apps/api/src/modules/auth.js';
loadRootEnv();
if (process.env.NODE_ENV === 'production')
  throw new Error('O seed de demonstração não pode rodar em produção.');
const url = process.env.DATABASE_URL;
if (!url || !['/apmail', '/apmail_test'].includes(new URL(url).pathname))
  throw new Error('Use somente o banco exclusivo de desenvolvimento.');
const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
if (!key) throw new Error('Chave de criptografia obrigatória.');
const db = createDb(url);
try {
  const password_hash = await hashPassword('Senha@123');
  const users = new Map<string, string>();
  for (const [name, email] of [
    ['Proprietário Demo', 'owner@apmail.local'],
    ['Administrador Demo', 'admin@apmail.local'],
    ['Editor Demo', 'editor@apmail.local'],
    ['Leitor Demo', 'leitor@apmail.local'],
  ]) {
    const u = await db
      .insertInto('users')
      .values({ email: email!, full_name: name!, password_hash })
      .onConflict((oc) => oc.column('email').doUpdateSet({ full_name: name! }))
      .returning('id')
      .executeTakeFirstOrThrow();
    users.set(email!, u.id);
    await db
      .insertInto('user_preferences')
      .values({ user_id: u.id })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
  }
  const tenant = await db
    .insertInto('tenants')
    .values({ name: 'Empresa Demo', slug: 'empresa-demo' })
    .onConflict((oc) => oc.column('slug').doUpdateSet({ name: 'Empresa Demo' }))
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [email, id] of users) {
    await db
      .insertInto('tenant_members')
      .values({
        tenant_id: tenant.id,
        user_id: id,
        role: email.startsWith('owner') ? 'owner' : email.startsWith('admin') ? 'admin' : 'member',
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doNothing())
      .execute();
    await db
      .updateTable('users')
      .set({ current_tenant_id: tenant.id })
      .where('id', '=', id)
      .execute();
  }
  for (const [name, email] of [
    ['Comercial', 'comercial@apmail.local'],
    ['Suporte', 'suporte@apmail.local'],
  ]) {
    let box = await db
      .selectFrom('mailboxes')
      .select('id')
      .where('tenant_id', '=', tenant.id)
      .where('email_address', '=', email!)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) {
      box = await db
        .insertInto('mailboxes')
        .values({
          name: name!,
          email_address: email!,
          tenant_id: tenant.id,
          imap_host: 'localhost',
          imap_port: 3143,
          imap_secure: false,
          smtp_host: 'localhost',
          smtp_port: 3025,
          smtp_secure: false,
          username: email!,
          created_by: users.get('owner@apmail.local')!,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeMailboxCredential(db, tenant.id, box.id, 'Senha123', key);
    }
    if (name === 'Comercial')
      for (const [email, role] of [
        ['editor@apmail.local', 'editor'],
        ['leitor@apmail.local', 'viewer'],
      ] as const)
        await db
          .insertInto('mailbox_members')
          .values({ tenant_id: tenant.id, mailbox_id: box.id, user_id: users.get(email)!, role })
          .onConflict((oc) => oc.columns(['mailbox_id', 'user_id']).doNothing())
          .execute();
  }
  console.info(
    'Empresa Demo, quatro usuários e duas caixas preparados. Senha de desenvolvimento: Senha@123',
  );
} finally {
  await db.destroy();
}
