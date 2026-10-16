import { describe, it, expect } from 'vitest';
import {
  invitationMessage,
  invitationEmailPreferencesSchema,
  DEFAULT_INVITATION_MESSAGE,
} from './invitation-email.js';

describe('padrão de convites', () => {
  it('preenche todas as variáveis sem substituir conteúdo introduzido pelo título', () => {
    expect(
      invitationMessage(
        '{{titulo}} · {{organizador}} · {{titulo}}',
        'Pauta {{organizador}}',
        'a@example.com',
      ),
    ).toBe('Pauta {{organizador}} · a@example.com · Pauta {{organizador}}');
    expect(
      invitationMessage(DEFAULT_INVITATION_MESSAGE, 'Planejamento', 'a@example.com'),
    ).toContain('convidado(a) para Planejamento');
  });
  it('exige texto e uma assinatura ao escolher uma específica', () => {
    expect(invitationEmailPreferencesSchema.safeParse({ message_template: ' ' }).success).toBe(
      false,
    );
    expect(
      invitationEmailPreferencesSchema.safeParse({
        message_template: 'Olá',
        signature_mode: 'selected',
      }).success,
    ).toBe(false);
    expect(invitationEmailPreferencesSchema.parse({ message_template: 'Olá' }).signature_mode).toBe(
      'default',
    );
  });
});
