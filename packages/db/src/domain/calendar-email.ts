import { DEFAULT_INVITATION_MESSAGE, invitationMessage, type CalendarInvite } from '@apmail/shared';
import { sanitizeEmailHtml } from '../sanitize.js';
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function calendarEmailHtml(invite: CalendarInvite, template = DEFAULT_INVITATION_MESSAGE) {
  const date = (s: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: invite.timezone,
      dateStyle: 'full',
      ...(invite.all_day ? {} : { timeStyle: 'short' }),
    }).format(new Date(s));
  const heading = {
    REQUEST: 'Convite de reunião',
    REPLY: 'Resposta ao convite',
    CANCEL: 'Reunião cancelada',
    PUBLISH: 'Compromisso',
  }[invite.method];
  const status =
    invite.method === 'REPLY'
      ? {
          ACCEPTED: 'Participação confirmada',
          DECLINED: 'Participação recusada',
          TENTATIVE: 'Talvez participe',
          'NEEDS-ACTION': 'Aguardando resposta',
        }[invite.attendees[0]?.status ?? 'NEEDS-ACTION']
      : 'Responda ao convite usando as opções de calendário do seu aplicativo de e-mail.';
  const introduction =
    invite.method === 'REQUEST'
      ? '<p>' +
        escape(invitationMessage(template, invite.title, invite.organizer)).replaceAll(
          '\n',
          '<br>',
        ) +
        '</p>'
      : '';
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:640px"><p style="color:#155e75">${heading}</p><h1 style="font-size:24px">${escape(invite.title)}</h1>${introduction}<p><strong>Quando</strong><br>${escape(date(invite.starts_at))}${invite.all_day ? ' · Dia inteiro' : ' — ' + escape(date(invite.ends_at))}<br><small>Fuso horário: ${escape(invite.timezone)}</small></p>${invite.location ? '<p><strong>Local</strong><br>' + escape(invite.location) + '</p>' : ''}${invite.meeting_url ? '<p><a href="' + escape(invite.meeting_url) + '" style="color:#155e75;font-weight:bold">Entrar na reunião</a><br>' + escape(invite.meeting_url) + '</p>' : ''}${invite.description_html ? sanitizeEmailHtml(invite.description_html, invite.description) : '<p>' + escape(invite.description).replaceAll('\n', '<br>') + '</p>'}<p><strong>Organizador</strong><br>${escape(invite.organizer)}</p><p><strong>Participantes</strong><br>${invite.attendees.map((a) => escape(a.name ? a.name + ' <' + a.address + '>' : a.address) + (a.role === 'optional' ? ' · Opcional' : '')).join('<br>')}</p><hr><p>${status}</p><p style="font-size:12px;color:#667085">Enviado pelo APMail. O convite de calendário está incluído nesta mensagem.</p></div>`;
}
