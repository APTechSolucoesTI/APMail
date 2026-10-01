import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDb, sql, migrate } from '../packages/db/src/index.js';
import { listThreads } from '../apps/api/src/modules/mail-visibility-queries.js';
import { threadListSchema } from '../apps/api/src/modules/mail.js';
import type { Resources } from '../apps/api/src/modules/resources.js';
import type { RequestContext } from '../apps/api/src/authz/context.js';
// Este gerador nunca escreve em DEV/produção; cria apenas uma caixa nova e desativada em TEST.
const url = process.env.DATABASE_URL_TEST;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Defina DATABASE_URL_TEST para um banco exclusivo terminado em _test.');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  box = randomUUID(),
  inbox = randomUUID(),
  clients = randomUUID(),
  secret = randomUUID();
try {
  await migrate(url);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('tenants')
      .values({ id: tenant, name: 'Carga 50 mil', slug: 'load-' + tenant })
      .execute();
    await tx
      .insertInto('users')
      .values({
        id: user,
        email: user + '@load.test',
        full_name: 'Carga QA',
        password_hash: 'disabled-fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await tx
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: user, role: 'owner' })
      .execute();
    await tx
      .insertInto('mailboxes')
      .values({
        id: box,
        tenant_id: tenant,
        name: 'Carga 50 mil',
        email_address: 'load@load.test',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'load',
        status: 'disabled',
      })
      .execute();
    await tx
      .insertInto('folders')
      .values([
        {
          id: inbox,
          tenant_id: tenant,
          mailbox_id: box,
          name: 'Entrada',
          imap_path: 'INBOX',
          special_use: 'inbox',
        },
        {
          id: clients,
          tenant_id: tenant,
          mailbox_id: box,
          name: 'Clientes',
          imap_path: 'Clientes',
        },
        { id: secret, tenant_id: tenant, mailbox_id: box, name: 'Interno', imap_path: 'Interno' },
      ])
      .execute();
    await sql`create temporary table load_mapping (n int primary key,id uuid not null) on commit drop`.execute(
      tx,
    );
    await sql`insert into load_mapping select n,gen_random_uuid() from generate_series(1,20000) n`.execute(
      tx,
    );
    await sql`insert into threads (id,tenant_id,mailbox_id,subject,queue_status,last_inbound_at,last_message_at,message_count) select id,${tenant},${box},'Atendimento '||n,case when n%3=0 then 'in_progress'::queue_status else 'to_reply'::queue_status end,now()-n*interval '1 minute',now()-n*interval '1 minute',2 from load_mapping`.execute(
      tx,
    );
    await sql`insert into messages (tenant_id,mailbox_id,folder_id,thread_id,message_id_header,subject,from_address,to_addresses,message_at,direction,snippet,body_text,has_attachments)
   select ${tenant},${box},case when s.n%3=0 then ${secret}::uuid when s.n%3=1 then ${inbox}::uuid else ${clients}::uuid end,t.id,'<'||gen_random_uuid()||'@load.test>','Atendimento '||t.n,'cliente'||(s.n%1000)||'@load.test','[{"name":"Equipe","address":"load@load.test"}]'::jsonb,now()-s.n*interval '1 minute','inbound',case when s.n%10=0 then 'urgente especial' else 'Atendimento em andamento' end,case when s.n%10=0 then 'urgente especial ' else '' end||repeat('Solicitação do cliente: verificar o equipamento, retornar com o diagnóstico e registrar a solução. ',10),s.n%5=0
   from generate_series(1,50000) s(n) join load_mapping t on t.n=(s.n-1)%20000+1`.execute(tx);
  });
  await sql`analyze messages`.execute(db);
  await sql`analyze threads`.execute(db);
  await sql`analyze folders`.execute(db);
  const ctx: RequestContext & { tenantId: string; tenantRole: 'owner' } = {
    userId: user,
    tenantId: tenant,
    tenantRole: 'owner',
    requestId: randomUUID(),
    ip: '127.0.0.1',
    sessionHash: 'load-fixture',
    mailboxRoles: new Map(),
  };
  const resources = { db } as Resources,
    results: { view: string; execution_ms: number; planning_ms: number; plan: unknown }[] = [];
  for (const view of ['folder', 'queue', 'search'] as const) {
    const q = threadListSchema.parse({
      view,
      queue: view === 'queue' ? 'to_reply' : undefined,
      q: view === 'search' ? 'urgente especial' : undefined,
      page_size: 50,
    });
    await listThreads(resources, ctx, box, q, async (compiled) => {
      const explained = await db.executeQuery({
        ...compiled,
        sql: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + compiled.sql,
      });
      const plan = (explained.rows[0] as { 'QUERY PLAN': Record<string, unknown>[] })[
        'QUERY PLAN'
      ][0]!;
      results.push({
        view,
        execution_ms: Number(plan['Execution Time']),
        planning_ms: Number(plan['Planning Time']),
        plan,
      });
    });
  }
  await mkdir('.data/qa', { recursive: true });
  await writeFile(
    '.data/qa/phase8-load.json',
    JSON.stringify({ tenant, box, messages: 50000, threads: 20000, results }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        box,
        messages: 50000,
        threads: 20000,
        results: results.map(({ view, execution_ms, planning_ms }) => ({
          view,
          execution_ms,
          planning_ms,
        })),
      },
      null,
      2,
    ),
  );
  if (results.some((row) => row.execution_ms >= 300))
    throw Error('Meta de 300 ms não atingida; consulte os planos em .data/qa/phase8-load.json.');
} finally {
  await db.destroy();
}
