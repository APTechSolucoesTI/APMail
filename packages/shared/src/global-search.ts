import { z } from 'zod';
export const searchCategories = {
  contact: 'Contatos',
  company: 'Empresas',
  email: 'E-mails',
  mailbox: 'Caixas de entrada',
  setting: 'Configurações',
  queue: 'Filas',
  label: 'Etiquetas',
  folder: 'Pastas',
  outbox: 'Envios e rascunhos',
  chat: 'Chat',
} as const;
export type SearchCategory = keyof typeof searchCategories;
export const globalSearchSchema = z.object({ q: z.string().trim().min(2).max(200) });
export type GlobalSearchItem = {
  category: SearchCategory;
  id: string;
  title: string;
  description: string;
  url: string;
};
export type GlobalSearchResponse = {
  query: string;
  groups: { category: SearchCategory; items: GlobalSearchItem[]; has_more: boolean }[];
};
