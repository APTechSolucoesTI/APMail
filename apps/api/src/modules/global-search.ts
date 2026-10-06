import type { FastifyInstance } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import {
  isTenantAdmin,
  canDelegate,
  normalizeRuleText,
  globalSearchSchema,
  QUEUE_LABELS,
  type SearchCategory,
  type GlobalSearchItem,
  type GlobalSearchResponse,
} from '@apmail/shared';
import { requireTenant } from '../authz/context.js';
import { contactVisible, contactSearch } from './contacts.js';
import { companyVisible, companySearch } from './companies.js';
import type { Resources } from './resources.js';

type Row = {
  id: string;
  title: string;
  description: string;
  mailbox_id?: string;
  thread_id?: string;
  status?: string;
};
export async function registerGlobalSearch(app: FastifyInstance, r: Resources) {
  app.get(
    '/api/search',
    { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
    async (req): Promise<GlobalSearchResponse> => {
      const c = requireTenant(req.ctx),
        { q } = globalSearchSchema.parse(req.query);
      const normalized = normalizeRuleText(q),
        pattern = '%' + normalized.replace(/[%_\\]/g, '\\$&') + '%';
      const matches = (text: RawBuilder<unknown>) =>
        sql<boolean>`lower(unaccent(coalesce(${text},''))) like ${pattern}`;
      // Permissions are applied before matching, ranking and limiting, including
      // recursive folder grants. Restricted messages never supply result metadata.
      const scope = sql`with recursive boxes as (
      select b.id,b.name,b.email_address,(${isTenantAdmin(c.tenantRole)} or mm.role='mailbox_admin' or not mm.restrict_to_folders) as full_access
      from mailboxes b left join mailbox_members mm on mm.mailbox_id=b.id and mm.tenant_id=b.tenant_id and mm.user_id=${c.userId}
      where b.tenant_id=${c.tenantId} and b.deleted_at is null and (${isTenantAdmin(c.tenantRole)} or mm.user_id is not null)
    ), allowed_folders as (
      select f.id,f.mailbox_id from folders f join boxes b on b.id=f.mailbox_id where f.tenant_id=${c.tenantId} and f.deleted_at is null
      and (b.full_access or exists(select 1 from folder_permissions p where p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id and p.folder_id=f.id and p.user_id=${c.userId}))
      union select f.id,f.mailbox_id from folders f join allowed_folders a on a.id=f.parent_id and a.mailbox_id=f.mailbox_id where f.tenant_id=${c.tenantId} and f.deleted_at is null
    )`;
      const readableMessage = sql<boolean>`(b.full_access or exists(select 1 from allowed_folders f where f.id=m.folder_id and f.mailbox_id=m.mailbox_id))`;
      const queries: [SearchCategory, RawBuilder<Row>][] = [
        [
          'company',
          sql<Row>`select cc.id,cc.name as title,concat_ws(' · ',nullif(cc.trade_name,''),cc.cnpj) as description from contact_companies cc where cc.tenant_id=${c.tenantId} and ${companyVisible(c)} and ${companySearch(q)} order by cc.name,cc.id limit 6`,
        ],
        [
          'contact',
          sql<Row>`select contacts.id,contacts.name as title,coalesce((select e.email from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id order by e.is_primary desc,e.email limit 1),'') as description
        from contacts where contacts.tenant_id=${c.tenantId} and ${contactVisible(c)} and ${contactSearch(q)} order by contacts.name,contacts.id limit 6`,
        ],
        [
          'mailbox',
          sql<Row>`${scope} select id,name as title,email_address as description,id as mailbox_id from boxes where ${matches(sql`name||' '||email_address`)} order by name,id limit 6`,
        ],
        [
          'email',
          sql<Row>`${scope}, matching as (
        select distinct on (t.id) t.id,b.id as mailbox_id,m.subject as title,concat_ws(' · ',m.from_name,m.from_address,b.name) as description,m.message_at
        from messages m join boxes b on b.id=m.mailbox_id join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id
        where m.tenant_id=${c.tenantId} and m.deleted_at is null and t.deleted_at is null and ${readableMessage}
        and (m.search_vector @@ websearch_to_tsquery('pt_unaccent',${q}) or ${matches(sql`m.subject||' '||m.from_address`)})
        order by t.id,m.message_at desc,m.id)
        select id,mailbox_id,coalesce(nullif(title,''),'Sem assunto') as title,description from matching order by message_at desc,id limit 6`,
        ],
        [
          'folder',
          sql<Row>`${scope} select f.id,f.mailbox_id,f.name as title,b.name as description from folders f join allowed_folders a on a.id=f.id join boxes b on b.id=f.mailbox_id where ${matches(sql`f.name||' '||b.name`)} order by f.name,f.id limit 6`,
        ],
        [
          'label',
          sql<Row>`select id,name as title,'Etiqueta pessoal' as description from personal_labels where tenant_id=${c.tenantId} and user_id=${c.userId} and ${matches(sql`name`)} order by name,id limit 6`,
        ],
        [
          'outbox',
          sql<Row>`${scope} select o.id,o.mailbox_id,o.thread_id,o.status,coalesce(nullif(o.subject,''),'Sem assunto') as title,b.name as description from outbox o join boxes b on b.id=o.mailbox_id
        where o.tenant_id=${c.tenantId} and o.status in ('draft','scheduled','queued','sending','failed')
        and (o.status!='draft' or o.created_by=${c.userId})
        and (o.created_by=${c.userId} or b.full_access or exists(select 1 from messages m where m.tenant_id=o.tenant_id and m.mailbox_id=o.mailbox_id and m.thread_id=o.thread_id and m.deleted_at is null and ${readableMessage}))
        and ${matches(sql`o.subject||' '||o.body_html`)} order by o.updated_at desc,o.id limit 6`,
        ],
        [
          'chat',
          sql<Row>`select cc.id,coalesce(nullif(cc.name,''),'Conversa da equipe') as title,'Conversa de chat' as description from chat_conversations cc
        join chat_participants cp on cp.conversation_id=cc.id and cp.tenant_id=cc.tenant_id and cp.user_id=${c.userId} and cp.left_at is null
        where cc.tenant_id=${c.tenantId} and (${matches(sql`cc.name`)} or exists(select 1 from chat_messages cm where cm.conversation_id=cc.id and cm.tenant_id=cc.tenant_id and cm.deleted_at is null and ${matches(sql`cm.body`)}))
        order by cc.updated_at desc,cc.id limit 6`,
        ],
      ];
      const settings = [
        ['/settings/profile', 'Meu perfil', 'Nome, foto e senha'],
        ['/settings/preferences', 'Preferências', 'Tema e notificações'],
        ['/settings/signatures', 'Assinaturas', 'Assinatura de e-mail'],
        ['/settings/labels', 'Etiquetas', 'Etiquetas pessoais'],
        ['/settings/rules', 'Regras', 'Minhas regras e regras da caixa'],
        ['/dashboard', 'Dashboard', 'Indicadores e atendimentos'],
        ['/contacts', 'Contatos', 'Pessoas, empresas e canais de contato'],
        ['/companies', 'Empresas', 'CNPJ, razão social, nome fantasia e endereços'],
        ['/scheduled', 'Envios', 'Rascunhos, agendados e falhas'],
        ...(isTenantAdmin(c.tenantRole)
          ? [
              ['/settings/tenant', 'Empresa', 'Armazenamento e capacidade'],
              ['/settings/mailboxes', 'Caixas de e-mail', 'Conexão IMAP/SMTP e armazenamento'],
            ]
          : []),
        ...(isTenantAdmin(c.tenantRole) || canDelegate(c.tenantRole, c.capabilities, 'members')
          ? [['/settings/users', 'Equipe e acessos', 'Usuários e permissões']]
          : []),
        ...(isTenantAdmin(c.tenantRole) || canDelegate(c.tenantRole, c.capabilities, 'audit')
          ? [['/settings/audit', 'Auditoria', 'Histórico de ações']]
          : []),
      ].filter((s) => normalizeRuleText('configuracoes ' + s.join(' ')).includes(normalized));
      const result = await r.db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          const groups: GlobalSearchResponse['groups'] = [];
          for (const [category, query] of queries) {
            const { rows } = await query.execute(tx);
            const items: GlobalSearchItem[] = rows.slice(0, 5).map((row) => {
              let url = '/contacts?contactId=' + row.id;
              if (category === 'company') url = '/companies?companyId=' + row.id;
              if (category === 'mailbox') url = '/mail/' + row.id;
              if (category === 'email')
                url =
                  '/mail/' +
                  row.mailbox_id +
                  '?' +
                  new URLSearchParams({ view: 'search', q, thread: row.id });
              if (category === 'folder')
                url =
                  '/mail/' +
                  row.mailbox_id +
                  '?' +
                  new URLSearchParams({ view: 'folder', folderId: row.id });
              if (category === 'label')
                url = '/settings/labels?' + new URLSearchParams({ search: row.title });
              if (category === 'chat') url = '/chat/' + row.id;
              if (category === 'outbox')
                url =
                  row.status === 'draft'
                    ? '/mail/' +
                      row.mailbox_id +
                      '?' +
                      new URLSearchParams({ compose: 'draft:' + row.id })
                    : '/scheduled?' +
                      new URLSearchParams({
                        mailboxId: row.mailbox_id!,
                        tab:
                          row.status === 'failed'
                            ? 'failed'
                            : row.status === 'scheduled'
                              ? 'scheduled'
                              : 'queued',
                        search: row.title === 'Sem assunto' ? '' : row.title,
                      });
              return { category, id: row.id, title: row.title, description: row.description, url };
            });
            groups.push({ category, items, has_more: rows.length > 5 });
          }
          const boxes = (
            await sql<Row>`${scope} select id,name as title,email_address as description from boxes order by name,id`.execute(
              tx,
            )
          ).rows;
          const queues = boxes.flatMap((b) =>
            Object.entries({ ...QUEUE_LABELS, overdue: 'Atrasados' })
              .filter(
                ([key, label]) =>
                  key !== 'none' &&
                  normalizeRuleText('fila ' + label + ' ' + b.title).includes(normalized),
              )
              .map(([key, label]): GlobalSearchItem => ({
                category: 'queue',
                id: b.id + ':' + key,
                title: label,
                description: b.title,
                url: '/mail/' + b.id + '?' + new URLSearchParams({ view: 'queue', queue: key }),
              })),
          );
          groups.push({
            category: 'queue',
            items: queues.slice(0, 5),
            has_more: queues.length > 5,
          });
          groups.push({
            category: 'setting',
            items: settings.slice(0, 5).map(([url, title, description]) => ({
              category: 'setting',
              id: url!,
              title: title!,
              description: description!,
              url: url!,
            })),
            has_more: settings.length > 5,
          });
          return groups;
        });
      return { query: q, groups: result };
    },
  );
}
