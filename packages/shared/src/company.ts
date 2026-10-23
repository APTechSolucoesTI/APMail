import { z } from 'zod';
import { emailSchema } from './schemas/common.js';
import { phoneSchema } from './contacts.js';

export const BRAZIL_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
  'EX',
] as const;
export function normalizeCnpj(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[./\s-]/g, '');
}
export function isValidCnpj(value: string): boolean {
  const normalized = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(normalized) || /^(.)\1{13}$/.test(normalized)) return false;
  const digit = (text: string) => {
    let weight = text.length - 7;
    const sum = [...text].reduce((total, char) => {
      const next = total + (char.charCodeAt(0) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return next;
    }, 0);
    return sum % 11 < 2 ? '0' : String(11 - (sum % 11));
  };
  const first = digit(normalized.slice(0, 12));
  return normalized.slice(-2) === first + digit(normalized.slice(0, 12) + first);
}
export const cnpjSchema = z
  .string()
  .trim()
  .max(30)
  .transform(normalizeCnpj)
  .refine(isValidCnpj, 'Informe um CNPJ válido.');
const text = (max: number) => z.string().trim().max(max).optional();
export const companyDetailsSchema = z.object({
  legal_name: text(200),
  trade_name: text(200),
  cnpj: cnpjSchema.or(z.literal('')).optional(),
  state_registration: text(40),
  municipal_registration: text(40),
  contact_name: text(120),
  email: emailSchema.or(z.literal('')).optional(),
  phone: phoneSchema.or(z.literal('')).optional(),
  website: z
    .string()
    .trim()
    .max(500)
    .pipe(
      z
        .url({ protocol: /^https?$/, error: 'Informe uma URL iniciada por https:// ou http://.' })
        .or(z.literal('')),
    )
    .optional(),
  postal_code: z
    .string()
    .trim()
    .transform((value) => value.replace('-', ''))
    .refine((value) => !value || /^\d{8}$/.test(value), 'Informe um CEP de 8 dígitos.')
    .optional(),
  street: text(200),
  number: text(30),
  complement: text(120),
  district: text(120),
  city: text(120),
  state: z.enum(BRAZIL_STATES).or(z.literal('')).optional(),
  country: text(80),
});
export type CompanyDetails = z.infer<typeof companyDetailsSchema>;
