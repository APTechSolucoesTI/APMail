import { z } from 'zod';

export const DEFAULT_INVITATION_MESSAGE =
  'Olá,\n\nVocê está convidado(a) para {{titulo}}.\nConfira os detalhes da reunião abaixo e confirme sua participação pelo convite de calendário.\n\nAté lá!';

export const invitationEmailPreferencesSchema = z
  .object({
    message_template: z.string().trim().min(1, 'Informe o texto do convite.').max(10000),
    mailbox_id: z.uuid().nullable().default(null),
    signature_mode: z.enum(['default', 'none', 'selected']).default('default'),
    signature_id: z.uuid().nullable().default(null),
  })
  .refine((value) => value.signature_mode !== 'selected' || !!value.signature_id, {
    path: ['signature_id'],
    message: 'Escolha uma assinatura.',
  });
export type InvitationEmailPreferences = z.infer<typeof invitationEmailPreferencesSchema>;

export function invitationMessage(template: string, title: string, organizer: string): string {
  return template.replace(/\{\{(titulo|organizador)\}\}/g, (_, key: string) =>
    key === 'titulo' ? title : organizer,
  );
}
