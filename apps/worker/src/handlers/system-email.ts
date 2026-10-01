import nodemailer from 'nodemailer';
import type { WorkerEnv } from '../env.js';
import { z } from 'zod';
import { inviteEmail } from '../templates/invite.js';
import { passwordResetEmail } from '../templates/password-reset.js';
import { passwordChangedEmail } from '../templates/password-changed.js';
const payload = z.object({ to: z.email(), data: z.record(z.string(), z.string()) });
export function createSystemEmailHandler(env: WorkerEnv) {
  const transport = nodemailer.createTransport({
    host: env.SYSTEM_SMTP_HOST,
    port: env.SYSTEM_SMTP_PORT,
    secure: env.SYSTEM_SMTP_SECURE,
    ...(env.SYSTEM_SMTP_USER
      ? { auth: { user: env.SYSTEM_SMTP_USER, pass: env.SYSTEM_SMTP_PASSWORD } }
      : {}),
  });
  return async (name: string, input: unknown) => {
    const { to, data } = payload.parse(input);
    const templates = {
      invite: inviteEmail(data),
      'password-reset': passwordResetEmail(data),
      'password-changed': passwordChangedEmail(),
    };
    const template = templates[name as keyof typeof templates];
    if (!template) throw new Error('Template de e-mail não reconhecido.');
    if (data.link && !data.link.startsWith(env.APP_URL + '/'))
      throw new Error('Link de e-mail inválido.');
    await transport.sendMail({ from: env.SYSTEM_MAIL_FROM, to, ...template });
  };
}
