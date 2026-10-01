import { emailLayout } from './layout.js';
export function passwordChangedEmail() {
  const title = 'Sua senha foi alterada — APMail';
  const body =
    'A senha da sua conta APMail foi alterada. Se você não realizou esta ação, contate o administrador.';
  return { subject: title, text: body, html: emailLayout(title, body) };
}
