import { z } from 'zod';
import { emailSchema } from './common.js';

export const addressSchema = z.object({
  name: z.string().max(200).default(''),
  address: emailSchema,
});
export const outboxAttachmentSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('upload'), upload_id: z.uuid() }),
  z.object({ source: z.literal('message_attachment'), attachment_id: z.uuid() }),
]);
// Rascunhos podem estar incompletos; destinatários são obrigatórios apenas no submit.
export const outboxSchema = z.object({
  mailbox_id: z.uuid(),
  kind: z.enum(['new', 'reply', 'reply_all', 'forward']).default('new'),
  thread_id: z.uuid().nullable().optional(),
  reply_to_message_id: z.uuid().nullable().optional(),
  to_addresses: z.array(addressSchema).max(100).default([]),
  cc_addresses: z.array(addressSchema).max(100).default([]),
  bcc_addresses: z.array(addressSchema).max(100).default([]),
  subject: z
    .string()
    .max(998)
    .refine((v) => !/[\r\n\0]/.test(v), 'Assunto inválido.')
    .default(''),
  body_html: z.string().max(1_000_000).default(''),
  signature_id: z.uuid().nullable().optional(),
  attachments: z.array(outboxAttachmentSchema).max(100).default([]),
});
export const signatureSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mailbox_id: z.uuid().nullable().default(null),
  body_html: z.string().max(100_000),
  is_default: z.boolean().default(false),
});
export type OutboxInput = z.infer<typeof outboxSchema>;
export type OutboxAttachment = z.infer<typeof outboxAttachmentSchema>;
