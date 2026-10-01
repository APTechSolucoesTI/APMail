import { emailLayout } from './layout.js';
export function passwordResetEmail(data: Record<string, string>) {
  const title = 'Redefinição de senha — APMail';
  const body =
    'Redefina sua senha pelo link abaixo. Ele expira em 1 hora. Se você não fez esta solicitação, ignore esta mensagem.';
  return {
    subject: title,
    text: `${body}\n\n${data.link}`,
    html: emailLayout(title, body, { label: 'Redefinir senha', url: data.link ?? '' }),
  };
}
