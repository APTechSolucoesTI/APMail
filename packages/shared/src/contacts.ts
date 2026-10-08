import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { emailSchema } from './schemas/common.js';
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, ctx) => {
    const phone = /^[+\d\s().-]+$/.test(value)
      ? parsePhoneNumberFromString(value, { defaultCountry: 'BR', extract: false })
      : undefined;
    if (!phone?.isValid()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe um telefone válido com DDD ou código internacional.',
      });
      return z.NEVER;
    }
    return phone.number;
  });
const text = (max = 120) => z.string().trim().max(max).default('');
export const contactAddressSchema = z.object({
  type: z.enum(['work', 'home', 'other']).default('home'),
  cep: text(20),
  street: text(200),
  number: text(30),
  complement: text(120),
  district: text(),
  city: text(),
  state: text(80),
  country: z.string().trim().max(80).default('Brasil'),
});
export const contactPhoneSchema = z.object({
  number: phoneSchema,
  label: text(80),
  is_primary: z.boolean().optional(),
});
export const contactSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome completo do contato.').max(200),
    nickname: z.string().trim().max(120).optional(),
    first_name: text(),
    middle_name: text(),
    last_name: text(),
    prefix: text(40),
    suffix: text(40),
    company: text(200),
    job_title: text(),
    department: text(),
    office: text(),
    website: z
      .union([z.literal(''), z.url().refine((v) => /^https?:\/\//i.test(v), 'Use http ou https.')])
      .default(''),
    birthday: z.union([z.literal(''), z.iso.date()]).default(''),
    phone: z.union([z.literal(''), phoneSchema]).default(''),
    phones: z.array(contactPhoneSchema).max(100).default([]),
    addresses: z.array(contactAddressSchema).max(50).default([]),
    notes: text(5000),
    emails: z
      .array(z.object({ email: emailSchema, label: text(80), is_primary: z.boolean().optional() }))
      .max(100)
      .default([]),
    expected_version: z.number().int().positive().optional(),
  })
  .superRefine((contact, ctx) => {
    if (!contact.emails.length && !contact.phones.length && !contact.phone)
      ctx.addIssue({
        code: 'custom',
        path: ['emails'],
        message: 'Cadastre ao menos um e-mail ou telefone válido.',
      });
    for (const key of ['emails', 'phones'] as const) {
      if (contact[key].filter((i) => i.is_primary).length > 1)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Defina somente um principal.' });
      const values =
        key === 'emails' ? contact.emails.map((i) => i.email) : contact.phones.map((i) => i.number);
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Há valores repetidos no contato.' });
    }
  });
export type ContactInput = z.infer<typeof contactSchema>;
export type ContactDetail = ContactInput & {
  id: string;
  scope: 'tenant' | 'personal';
  owner_user_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  updated_by_name: string;
};
