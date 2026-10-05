import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';
import { sql } from 'kysely';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { reconcileStorage, requestStorageScan } from './metering-scan.js';

const url = process.env.DATABASE_URL_TEST;
if (process.platform !== 'linux') throw Error('Execute o laboratório em Linux.');
if (!url || new URL(url).pathname !== '/apmail_storage_scale_test')
  throw Error('Use apenas o banco exclusivo apmail_storage_scale_test.');
await migrate(url);
const db = createDb(url),
  root = await mkdtemp(join(tmpdir(), 'apmail-storage-scale-'));
const tenant = randomUUID(),
  boxes = Array.from({ length: 100 }, () => randomUUID()),
  threads = Array.from({ length: 100 }, () => randomUUID());
const started = Date.now();
let maxRss = process.memoryUsage().rss;
const timer = setInterval(() => {
  maxRss = Math.max(maxRss, process.memoryUsage().rss);
}, 1000);
try {
  const free = await import('node:fs/promises').then((fs) => fs.statfs(root, { bigint: true }));
  if (free.bavail * free.bsize < 8n * 1024n ** 3n)
    throw Error('São necessários pelo menos 8 GiB livres para este laboratório.');
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Scale QA', slug: 'scale-' + tenant })
    .execute();
  await db
    .insertInto('mailboxes')
    .values(
      boxes.map((id) => ({
        id,
        tenant_id: tenant,
        name: 'Scale',
        email_address: id + '@qa.local',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        status: 'disabled',
      })),
    )
    .execute();
  await db
    .insertInto('threads')
    .values(threads.map((id, i) => ({ id, tenant_id: tenant, mailbox_id: boxes[i]! })))
    .execute();
  console.log('Fixture: 1.000.000 mensagens, 100 caixas, 100.000 arquivos de 16 bytes.');
  await sql`insert into messages(id,tenant_id,mailbox_id,thread_id,message_id_header,direction,message_at,body_html,body_text)
    select md5(${tenant}||':'||i::text)::uuid,${tenant}::uuid,(${boxes}::uuid[])[(i-1)%100+1],(${threads}::uuid[])[(i-1)%100+1],
      '<scale-'||i::text||'@qa>','inbound',now(),'<p>Scale QA ação</p>','Scale QA texto' from generate_series(1,1000000) i`.execute(
    db,
  );
  console.log('Mensagens geradas:', Date.now() - started, 'ms');
  for (let b = 0; b < 100; b++) {
    const dir = join(root, 'attachments', tenant, boxes[b]!, 'scale');
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 1000; i++)
      await writeFile(join(dir, String(b * 1000 + i)), Buffer.alloc(16));
  }
  await sql`insert into attachments(tenant_id,mailbox_id,message_id,filename,content_type,size_bytes,storage_path)
    select ${tenant}::uuid,(${boxes}::uuid[])[(i-1)%100+1],md5(${tenant}||':'||i::text)::uuid,'qa.bin','application/octet-stream',16,
      'attachments/'||${tenant}||'/'||(${boxes}::uuid[])[(i-1)%100+1]::text||'/scale/'||
      ((((i-1)%100)*1000)+((i-1)/100))::text from generate_series(1,100000) i`.execute(db);
  await sql`analyze`.execute(db);
  const prepared = Date.now(),
    run = await requestStorageScan(db, 'full');
  let batches = 0;
  while (!(await reconcileStorage(db, root, run, 5000, 20000))) {
    batches++;
    console.log('Inventário: lote', batches);
  }
  const snapshot = await db
    .selectFrom('storage_usage_snapshots')
    .select('usage')
    .where('scan_id', '=', run)
    .where('scope_id', '=', tenant)
    .executeTakeFirstOrThrow();
  const usage = snapshot.usage as {
    file_bytes: string;
    messages: number;
    files: number;
    discrepancies: number;
  };
  assert.equal(usage.file_bytes, '1600000');
  assert.equal(usage.files, 100000);
  assert.equal(usage.messages, 1000000);
  assert.equal(usage.discrepancies, 0);
  const report = {
    messages: 1000000,
    files: 100000,
    mailboxes: 100,
    fixture_ms: prepared - started,
    reconcile_ms: Date.now() - prepared,
    batches: batches + 1,
    max_rss_bytes: String(maxRss),
    usage,
  };
  const output = process.env.STORAGE_BENCHMARK_REPORT;
  if (output) await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  clearInterval(timer);
  await db.destroy();
  // Only the mkdtemp directory created by this script can be removed.
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '/apmail-storage-scale-'));
  await rm(root, { recursive: true, force: true });
}
