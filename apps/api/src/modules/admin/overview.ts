import type { FastifyInstance } from 'fastify';
import { hasAccess, legacyAccessPermissions, type AccessPermission } from '@apmail/shared';
import { requireTenant, forbidden } from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import { readTenantQuota } from '../storage-quotas.js';
import { readAntivirusOverview } from '../antivirus.js';
import { visibleAuditQuery } from '../audit.js';
import type { Resources } from '../resources.js';
export function registerAdminOverview(app: FastifyInstance, r: Resources) {
  app.get('/api/admin/overview', async (req) => {
    const c = requireTenant(req.ctx),
      identity = {
        role: c.tenantRole,
        access_permissions:
          c.accessPermissions ?? legacyAccessPermissions(c.tenantRole, c.capabilities),
      };
    const allowed = (p: AccessPermission) => hasAccess(identity, p);
    const sections: Record<string, unknown> = {};
    const block = async (key: string, permission: AccessPermission, fn: () => Promise<unknown>) => {
      if (!allowed(permission)) return;
      try {
        sections[key] = { state: 'ready', observed_at: new Date().toISOString(), data: await fn() };
      } catch {
        sections[key] = { state: 'error', message: 'Não foi possível atualizar esta informação.' };
      }
    };
    await Promise.all([
      block('domains', 'domains.view', async () => {
        const rows = await r.db
          .selectFrom('tenant_domains as d')
          .leftJoin('tenant_domain_checks as ch', 'ch.domain_id', 'd.id')
          .select(['d.id', 'ch.snapshot', 'ch.checked_at'])
          .where('d.tenant_id', '=', c.tenantId)
          .execute();
        return {
          total: rows.length,
          unchecked: rows.filter((d) => !d.checked_at).length,
          attention: rows.filter(
            (d) =>
              JSON.stringify(d.snapshot).includes('"invalid"') ||
              JSON.stringify(d.snapshot).includes('"error"'),
          ).length,
        };
      }),
      block('mailboxes', 'mailboxes.manage', async () => {
        const candidates = await r.db
          .selectFrom('mailboxes')
          .select([
            'id',
            'name',
            'email_address',
            'status',
            'receiving_protocol',
            'last_synced_at',
            'connection_error_kind',
          ])
          .where('tenant_id', '=', c.tenantId)
          .where('deleted_at', 'is', null)
          .execute();
        const boxes = [];
        for (const b of candidates) {
          try {
            await requireMailboxPerm(c, r.db, b.id, 'read');
            boxes.push(b);
          } catch {
            /* preserve scope */
          }
        }
        return {
          total: boxes.length,
          active: boxes.filter((b) => b.status === 'active').length,
          local: boxes.filter((b) => b.receiving_protocol === 'local').length,
          error: boxes.filter((b) => b.status === 'error' && b.receiving_protocol !== 'local')
            .length,
          issues: boxes
            .filter((b) => b.status === 'error' && b.receiving_protocol !== 'local')
            .map((b) => ({
              id: b.id,
              label: b.name + ' · ' + b.email_address,
              href: '/admin/mailboxes/' + b.id,
            })),
        };
      }),
      block('storage', 'company.manage', async () => {
        const quota = await readTenantQuota(r, c.tenantId);
        return {
          used_bytes: quota.used_bytes,
          storage_limit_bytes: quota.storage_limit_bytes,
          provider: quota.provider,
          max_mailboxes: quota.max_mailboxes,
        };
      }),
      block('team', 'users.view', async () => {
        const rows = await r.db
          .selectFrom('tenant_members')
          .select('status')
          .where('tenant_id', '=', c.tenantId)
          .execute();
        const invitations = await r.db
          .selectFrom('invitations')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('accepted_at', 'is', null)
          .where('revoked_at', 'is', null)
          .where('expires_at', '>', new Date())
          .execute();
        return {
          active: rows.filter((v) => v.status === 'active').length,
          disabled: rows.filter((v) => v.status === 'disabled').length,
          pending_invitations: invitations.length,
        };
      }),
      block('security', 'antivirus.view', async () => {
        const security = await readAntivirusOverview(r, c.tenantId);
        return { ...security.counts, health_stale: security.health.stale };
      }),
      block('audit', 'audit.view', async () => {
        const { query } = await visibleAuditQuery(r, c);
        return {
          events: await query
            .select(['a.id', 'a.action', 'a.created_at', 'u.full_name as actor_name'])
            .orderBy('a.created_at', 'desc')
            .limit(10)
            .execute(),
        };
      }),
      block('mail_policy', 'company.manage', async () => {
        const row = await r.db
          .selectFrom('tenants')
          .select('settings')
          .where('id', '=', c.tenantId)
          .executeTakeFirstOrThrow();
        const settings = row.settings as { mail_queues_enabled?: boolean };
        return { enabled: settings.mail_queues_enabled !== false };
      }),
      block('integrations', 'integrations', async () => [
        { href: '/admin/integrations', label: 'Gerenciar minhas integrações' },
      ]),
      block('reports', 'reports', async () => [
        { href: '/admin/reports', label: 'Consultar relatórios autorizados' },
      ]),
    ]);
    if (!Object.keys(sections).length) throw forbidden();
    return { generated_at: new Date().toISOString(), sections };
  });
}
