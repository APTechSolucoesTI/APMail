import { z } from 'zod';
import { emailSchema } from './schemas/common.js';
export const contactAddressSchema = z.object({
  cep: z.string().max(10).default(''),
  street: z.string().trim().max(200).default(''),
  number: z.string().trim().max(30).default(''),
  complement: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  city: z.string().trim().max(120).default(''),
  state: z.string().trim().max(30).default(''),
  country: z.string().trim().max(80).default('Brasil'),
});
export const contactCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  trade_name: z.string().trim().max(200).default(''),
  cnpj: z
    .string()
    .transform((s) => s.replace(/[.\-/\s]/g, '').toUpperCase())
    .refine((s) => s === '' || /^[A-Z\d]{12}\d{2}$/.test(s), 'CNPJ deve ter 14 caracteres.')
    .default(''),
});
export const contactLinkSchema = z
  .object({
    label: z.string().trim().max(80).default(''),
    company: contactCompanySchema.nullable().default(null),
    address: contactAddressSchema.nullable().default(null),
  })
  .refine((v) => v.company || v.address, 'Cadastre uma empresa ou endereço.');
export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(5000).default(''),
  emails: z
    .array(
      z.object({
        email: emailSchema,
        label: z.string().trim().max(80).default(''),
        links: z.array(contactLinkSchema).max(50).default([]),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((i) => i.email)).size === items.length,
      'Há e-mails repetidos no contato.',
    ),
  visibility: z.enum(['all', 'selected']).optional(),
  mailbox_ids: z.array(z.uuid()).max(100).optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;
export type ContactDetail = ContactInput & {
  id: string;
  visibility: 'all' | 'selected';
  mailbox_ids: string[];
  created_at: string;
  updated_at: string;
};
