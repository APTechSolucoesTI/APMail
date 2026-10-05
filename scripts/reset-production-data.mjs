// One-time operator utility. Run only with the application stopped and an independently verified backup.
// It preserves the schema, migration history, logical catalog and deployment/environment configuration.
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
const dependency = createRequire('/app/package.json');
const dbDependency = createRequire(await fs.realpath('/app/node_modules/@apmail/db/package.json'));
const { Client } = dbDependency('pg'),
  { Redis } = dbDependency('ioredis');
const { hash, Algorithm } = dependency('@node-rs/argon2');

(async () => {
  if (
    process.platform !== 'linux' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.APMAIL_RESET_CONFIRM !== 'RESET PRODUCTION APMAIL'
  )
    throw Error('Confirmação e ambiente de produção obrigatórios.');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    url.pathname !== '/' + process.env.APMAIL_RESET_DATABASE ||
    !['postgres', 'db'].includes(url.hostname)
  )
    throw Error('Banco diferente do alvo verificado.');
  if (process.env.APMAIL_RESET_PROJECT !== 'apmail-next-production-qrufqc')
    throw Error('Projeto diferente do servidor autorizado.');
  if (
    process.env.APMAIL_RESET_REDIS_ISOLATED !== 'true' ||
    new URL(process.env.REDIS_URL ?? '').pathname !== '/0'
  )
    throw Error('Redis dedicado deve ser verificado pelo operador.');
  const backup = '/backup',
    root = '/data/storage',
    credentials = '/reset-private/superadmin-credentials.json';
  const checks = await fs.readFile(path.join(backup, 'checksums.sha256'), 'utf8');
  for (const name of ['apmail.dump', 'storage.tar.gz', 'redis.rdb', 'secrets.env', 'project.txt']) {
    const expected = checks
      .split('\n')
      .find((v) => v.endsWith('  ' + name))
      ?.slice(0, 64);
    if (!expected) throw Error('Backup incompleto.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path.join(backup, name))) digest.update(chunk);
    if (digest.digest('hex') !== expected) throw Error('Checksum do backup inválido.');
  }
  if (
    (await fs.readFile(path.join(backup, 'project.txt'), 'utf8')).trim() !==
    process.env.APMAIL_RESET_PROJECT
  )
    throw Error('Backup de outro projeto.');
  if ((await fs.realpath(root)) !== root || (await fs.lstat(root)).isSymbolicLink())
    throw Error('Volume de arquivos inválido.');
  const db = new Client({ connectionString: process.env.DATABASE_URL }),
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  await db.connect();
  try {
    await redis.ping();
    const tables = (
      await db.query(
        "select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','storage_logical_catalog') order by tablename",
      )
    ).rows.map((v) => v.tablename);
    if (
      !['users', 'tenants', 'mailboxes', 'messages', 'platform_admins'].every((v) =>
        tables.includes(v),
      ) ||
      tables.some((v) => !/^[a-z_]+$/.test(v))
    )
      throw Error('Schema inesperado.');
    const external = (
      await db.query(
        "select count(*)::int as n from pg_constraint c join pg_class p on p.oid=c.confrelid join pg_namespace pn on pn.oid=p.relnamespace join pg_class r on r.oid=c.conrelid join pg_namespace rn on rn.oid=r.relnamespace where c.contype='f' and pn.nspname='public' and rn.nspname<>'public'",
      )
    ).rows[0].n;
    if (external) throw Error('Há dependências externas ao schema autorizado.');
    const email = 'sistema@aptechinfo.com.br',
      password = 'A!9' + randomBytes(24).toString('base64url');
    const passwordHash = await hash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await fs.writeFile(credentials, JSON.stringify({ email, password }), {
      mode: 0o600,
      flag: 'wx',
    });
    await db.query('BEGIN');
    try {
      await db.query("select pg_advisory_xact_lock(hashtext('apmail:production-reset'))");
      await db.query(
        'TRUNCATE ' +
          tables.map((v) => 'public."' + v + '"').join(',') +
          ' RESTART IDENTITY CASCADE',
      );
      const user = (
        await db.query(
          "insert into users(email,full_name,password_hash) values($1,'Administração APMail',$2) returning id",
          [email, passwordHash],
        )
      ).rows[0];
      await db.query('insert into platform_admins(user_id) values($1)', [user.id]);
      await db.query(
        "insert into user_preferences(user_id,theme,desktop_notifications,load_remote_images,notify_assignments,notify_chat,notify_mentions) values($1,'light',false,true,true,true,true)",
        [user.id],
      );
      await db.query(
        "insert into platform_audit(actor_id,action) values($1,'platform.admin_bootstrapped_after_authorized_reset')",
        [user.id],
      );
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
    // The caller proves these mounts and the Redis container belong to this exact Compose project.
    await redis.flushdb();
    for (const name of await fs.readdir(root)) {
      const target = path.resolve(root, name);
      if (path.dirname(target) !== root || target === root)
        throw Error('Alvo de arquivo inválido.');
      await fs.rm(target, { recursive: true, force: true });
    }
    const counts = (
      await db.query(
        'select (select count(*) from users)::int as users,(select count(*) from platform_admins)::int as superadmins,(select count(*) from tenants)::int as tenants,(select count(*) from mailboxes)::int as mailboxes,(select count(*) from messages)::int as messages,(select count(*) from tenant_members)::int as memberships',
      )
    ).rows[0];
    if (
      counts.users !== 1 ||
      counts.superadmins !== 1 ||
      counts.tenants ||
      counts.mailboxes ||
      counts.messages ||
      counts.memberships ||
      (await fs.readdir(root)).length
    )
      throw Error('Verificação final da limpeza falhou.');
    console.log(JSON.stringify({ reset: true, ...counts, files: 0 }));
  } finally {
    await db.end();
    await redis.quit();
  }
})().catch(() => {
  console.error('Limpeza interrompida. Preserve o backup e verifique o estado antes de retomar.');
  process.exitCode = 1;
});
