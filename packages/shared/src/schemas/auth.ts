import { z } from 'zod';
export const passwordSchema = z
  .string()
  .min(8, 'Use ao menos 8 caracteres.')
  .max(256)
  .regex(/[\p{L}]/u, 'Inclua uma letra.')
  .regex(/[0-9]/, 'Inclua um número.');
import { emailSchema } from './common.js';
import { SUPERVISOR_CAPABILITIES } from '../permissions.js';
export const capabilitiesSchema = z.array(z.enum(SUPERVISOR_CAPABILITIES)).max(6).default([]);
export const fullNameSchema = z.string().trim().min(2).max(120);
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) });
export const signupSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export const tenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
});
export const timezoneSchema = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido.');
export const tenantSettingsSchema = z
  .object({
    max_attachment_mb: z.number().int().min(1).max(25),
    sla_first_response_hours: z.number().int().min(1).max(720),
    default_sync_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
    allow_external_auto_forward: z.boolean(),
    default_invitation_mailbox_id: z.union([
      z.uuid(),
      z.literal('').transform(() => null),
      z.null(),
    ]),
  })
  .partial();
export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark']),
    density: z.enum(['comfortable', 'compact']),
    timezone: timezoneSchema,
    notify_mentions: z.boolean(),
    notify_assignments: z.boolean(),
    notify_chat: z.boolean(),
    desktop_notifications: z.boolean(),
    load_remote_images: z.boolean(),
  })
  .partial();
export const tableConfigSchema = z.object({
  visible: z.array(z.string().min(1).max(80)).min(1).max(100),
  order: z.array(z.string().min(1).max(80)).min(1).max(100),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)]),
});
export const mailboxRoleSchema = z.enum(['mailbox_admin', 'editor', 'viewer']);
export const mailboxAccessSchema = z.object({
  mailbox_id: z.uuid(),
  role: mailboxRoleSchema.nullable(),
  restrict_to_folders: z.boolean().default(false),
  folder_ids: z.array(z.uuid()).max(1000).default([]),
});
export const memberAccessSchema = z.object({
  tenant_role: z.enum(['owner', 'admin', 'member', 'supervisor']),
  capabilities: capabilitiesSchema,
  mailbox_roles: z.array(mailboxAccessSchema).max(100),
});
export const invitationSchema = z.object({
  email: emailSchema,
  tenant_role: z.enum(['admin', 'member', 'supervisor']),
  capabilities: capabilitiesSchema,
  sender_mailbox_id: z.uuid().optional(),
  mailbox_roles: z.array(z.object({ mailbox_id: z.uuid(), role: mailboxRoleSchema })).max(100),
});
export const mailboxSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email_address: emailSchema,
  aliases: z.array(emailSchema).max(30).default([]),
  from_name_template: z
    .string()
    .max(100)
    .refine((v) => !/[\r\n]/.test(v), 'Nome inválido.')
    .default('{mailbox_name}'),
  imap_host: z.string().trim().min(1).max(255),
  imap_port: z.number().int().min(1).max(65535),
  imap_secure: z.boolean(),
  smtp_host: z.string().trim().min(1).max(255),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
  sync_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).default(90),
  history_classify_days: z.number().int().min(0).max(90).default(0),
  append_sent_copy: z.boolean().default(true),
  members: z
    .array(z.object({ user_id: z.uuid(), role: mailboxRoleSchema }))
    .max(100)
    .default([]),
});
