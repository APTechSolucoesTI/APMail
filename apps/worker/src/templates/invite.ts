import { emailLayout } from './layout.js';
export function inviteEmail(data: Record<string, string>) {
  const title = `${data.inviter_name ?? 'Sua equipe'} convidou você para ${data.tenant_name ?? 'uma empresa'} no APMail`;
  const body = 'Aceite o convite para participar da equipe. O link expira em 7 dias.';
  return {
    subject: `Convite para ${data.tenant_name ?? 'sua empresa'} no APMail`,
    text: `${title}\n\n${body}\n\n${data.link}`,
    html: emailLayout(title, body, { label: 'Aceitar convite', url: data.link ?? '' }),
  };
}
