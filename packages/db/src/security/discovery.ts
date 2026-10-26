import { sql, type Kysely } from 'kysely';
import type { DB } from '../types.js';
import type { SecurityFileInput } from './files.js';

/** Metadata only. Legacy bytes stay inaccessible until a bounded backfill approves them. */
export function unverifiedFileCandidates(tenantId: string) {
  return sql<SecurityFileInput>`(
    select a.storage_path as storage_key,a.tenant_id,a.mailbox_id,null::uuid as user_id,
      a.message_id,a.id as resource_id,a.filename,a.content_type,a.size_bytes::bigint,'attachment'::text as kind
    from attachments a join messages m on m.id=a.message_id
    where a.tenant_id=${tenantId} and m.deleted_at is null
    union all
    select u.storage_path,u.tenant_id,u.mailbox_id,u.user_id,null::uuid,u.id,u.filename,u.content_type,u.size_bytes::bigint,'upload'
    from uploads u where u.tenant_id=${tenantId} and u.consumed_at is null
    union all
    select s.storage_path,s.tenant_id,null::uuid,s.user_id,null::uuid,s.id,'assinatura.png',s.content_type,s.size_bytes::bigint,'signature_image'
    from signature_images s where s.tenant_id=${tenantId}
    union all
    select u.avatar_path,null::uuid,null::uuid,u.id,null::uuid,u.id,'avatar.webp','image/webp',0::bigint,'avatar'
    from users u join tenant_members m on m.user_id=u.id where m.tenant_id=${tenantId} and m.status='active' and u.avatar_path is not null
    union all
    select i.storage_path,i.tenant_id,i.mailbox_id,i.created_by,null::uuid,i.id,i.filename,'application/octet-stream',i.size_bytes,'mail_import'
    from mail_archive_imports i where i.tenant_id=${tenantId} and i.storage_path is not null
      and i.state<>'uploading' and i.uploaded_bytes>=i.size_bytes
    union all
    select f.storage_path,f.tenant_id,f.mailbox_id,e.created_by,null::uuid,f.id,f.filename,'application/octet-stream',f.size_bytes,'mail_export'
    from mail_archive_export_files f join mail_archive_exports e on e.id=f.export_id
    where f.tenant_id=${tenantId} and f.kind='pst'
    union all
    select m.raw_storage_path,m.tenant_id,m.mailbox_id,null::uuid,m.id,m.id,'mensagem.eml','message/rfc822',m.size_bytes::bigint,'mail_raw'
    from messages m where m.tenant_id=${tenantId} and m.raw_storage_path is not null and m.deleted_at is null
  )`;
}
export function unverifiedQuery(tenantId: string) {
  return sql<SecurityFileInput>`select distinct on(c.storage_key) c.* from ${unverifiedFileCandidates(tenantId)} c
    where not exists(select 1 from file_security s where s.storage_key=c.storage_key) order by c.storage_key`;
}
export async function listUnverifiedFiles(db: Kysely<DB>, tenantId: string, limit = 100) {
  return (
    await sql<SecurityFileInput>`select * from (${unverifiedQuery(tenantId)}) c limit ${Math.max(1, Math.min(500, limit))}`.execute(
      db,
    )
  ).rows;
}
export async function countUnverifiedFiles(db: Kysely<DB>, tenantId: string) {
  return Number(
    (
      await sql<{
        total: string;
      }>`select count(*) as total from (${unverifiedQuery(tenantId)}) c`.execute(db)
    ).rows[0]?.total ?? 0,
  );
}
