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
  id: z.uuid().optional(),
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
    is_primary_company: z.boolean().optional(),
    company: contactCompanySchema.nullable().default(null),
    address: contactAddressSchema.nullable().default(null),
  })
  .refine((v) => v.company || v.address, 'Cadastre uma empresa ou endereço.')
  .refine(
    (v) => !v.is_primary_company || v.company,
    'O vínculo principal precisa ter uma empresa.',
  );
export const contactPhoneSchema = z.object({
  number: z.string().trim().min(1).max(40),
  label: z.string().trim().max(80).default(''),
  is_primary: z.boolean().optional(),
});
export const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    job_title: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).default(''),
    phones: z.array(contactPhoneSchema).max(100).optional(),
    notes: z.string().trim().max(5000).default(''),
    emails: z
      .array(
        z.object({
          email: emailSchema,
          label: z.string().trim().max(80).default(''),
          is_primary: z.boolean().optional(),
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
  })
  .superRefine((contact, ctx) => {
    if (contact.emails.filter((e) => e.is_primary).length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['emails'],
        message: 'Defina somente um e-mail principal.',
      });
    if (contact.emails.flatMap((e) => e.links).filter((l) => l.is_primary_company).length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['emails'],
        message: 'Defina somente uma empresa principal.',
      });
    if ((contact.phones?.filter((p) => p.is_primary).length ?? 0) > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['phones'],
        message: 'Defina somente um telefone principal.',
      });
    if (
      contact.phones &&
      new Set(contact.phones.map((p) => p.number.replace(/\D/g, '') || p.number.toLowerCase()))
        .size !== contact.phones.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['phones'],
        message: 'Há telefones repetidos no contato.',
      });
  });
export type ContactInput = z.infer<typeof contactSchema>;
export type ContactDetail = ContactInput & {
  id: string;
  visibility: 'all' | 'selected';
  mailbox_ids: string[];
  created_at: string;
  updated_at: string;
};
