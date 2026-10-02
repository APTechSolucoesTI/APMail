import nodemailer from 'nodemailer';
import type { WorkerEnv } from '../env.js';
import { z } from 'zod';
import { inviteEmail } from '../templates/invite.js';
import { passwordResetEmail } from '../templates/password-reset.js';
import { passwordChangedEmail } from '../templates/password-changed.js';
import type { Kysely } from 'kysely';
import type { DB } from '@apmail/db';
import { transports } from '../imap/connect.js';
import { createHash } from 'node:crypto';
const payload = z.object({
  to: z.email(),
  data: z.record(z.string(), z.string()),
  invitation_id: z.uuid().optional(),
});
export function createSystemEmailHandler(env: WorkerEnv, db?: Kysely<DB>) {
  const transport = nodemailer.createTransport({
    host: env.SYSTEM_SMTP_HOST,
    port: env.SYSTEM_SMTP_PORT,
    secure: env.SYSTEM_SMTP_SECURE,
    requireTLS: env.NODE_ENV === 'production' && !env.SYSTEM_SMTP_SECURE,
    ...(env.SYSTEM_SMTP_USER
      ? { auth: { user: env.SYSTEM_SMTP_USER, pass: env.SYSTEM_SMTP_PASSWORD } }
      : {}),
  });
  return async (name: string, input: unknown) => {
    const { to, data, invitation_id } = payload.parse(input);
    const templates = {
      invite: inviteEmail(data),
      'password-reset': passwordResetEmail(data),
      'password-changed': passwordChangedEmail(),
    };
    const template = templates[name as keyof typeof templates];
    if (!template) throw new Error('Template de e-mail não reconhecido.');
    if (data.link && !data.link.startsWith(env.APP_URL + '/'))
      throw new Error('Link de e-mail inválido.');
    let selected = transport,
      from = env.SYSTEM_MAIL_FROM;
    let mailboxTransport: Awaited<ReturnType<typeof transports>> | undefined;
    let currentInvitation = false;
    try {
      if (invitation_id) {
        if (!db) throw new Error('invitation_database_required');
        const invite = await db
          .selectFrom('invitations as i')
          .innerJoin('tenants as t', 't.id', 'i.tenant_id')
          .select([
            'i.tenant_id',
            'i.sender_mailbox_id',
            'i.sender_context',
            'i.invited_by',
            'i.email',
            'i.token_hash',
          ])
          .where('i.id', '=', invitation_id)
          .where('i.accepted_at', 'is', null)
          .where('i.revoked_at', 'is', null)
          .where('i.expires_at', '>', new Date())
          .where('t.suspended_at', 'is', null)
          .where('t.deleted_at', 'is', null)
          .executeTakeFirst();
        if (!invite || invite.email !== to) throw new Error('invitation_unavailable');
        const token = data.link && new URL(data.link).searchParams.get('token');
        if (!token || createHash('sha256').update(token).digest('hex') !== invite.token_hash)
          throw new Error('invitation_token_replaced');
        currentInvitation = true;
        if (invite.sender_context === 'tenant') {
          const member = await db
            .selectFrom('tenant_members')
            .select('id')
            .where('tenant_id', '=', invite.tenant_id)
            .where('user_id', '=', invite.invited_by)
            .where('status', '=', 'active')
            .where('role', 'in', ['admin', 'owner'])
            .executeTakeFirst();
          const box =
            invite.sender_mailbox_id &&
            (await db
              .selectFrom('mailboxes')
              .selectAll()
              .where('id', '=', invite.sender_mailbox_id)
              .where('tenant_id', '=', invite.tenant_id)
              .where('status', '=', 'active')
              .where('deleted_at', 'is', null)
              .executeTakeFirst());
          if (!member || !box) throw new Error('invitation_sender_unavailable');
          mailboxTransport = await transports(db, box, env);
          selected = mailboxTransport.smtp;
          from = box.email_address;
        } else if (invite.sender_context === 'platform') {
          const admin = await db
            .selectFrom('platform_admins')
            .select('user_id')
            .where('user_id', '=', invite.invited_by)
            .executeTakeFirst();
          if (!admin) throw new Error('platform_permission_revoked');
        }
      }
      await selected.sendMail({ from, to, ...template });
      if (invitation_id && db)
        await db
          .updateTable('invitations')
          .set({ delivery_status: 'sent', delivery_error: null })
          .where('id', '=', invitation_id)
          .execute();
    } catch (error) {
      if (invitation_id && db && currentInvitation)
        await db
          .updateTable('invitations')
          .set({
            delivery_status: 'failed',
            delivery_error: 'Não foi possível entregar. Verifique o remetente e tente reenviar.',
          })
          .where('id', '=', invitation_id)
          .execute();
      throw error;
    } finally {
      await mailboxTransport?.close();
    }
  };
}
