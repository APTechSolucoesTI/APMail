import type { ParsedMail } from 'mailparser';
import { parseCalendarInvite, type CalendarInvite } from '@apmail/shared';
/** Sender alignment is required; ICS attachment URLs and alarms are never executed. */
export function readCalendarInvite(
  mail: ParsedMail,
  sender: string,
  own: string[],
): CalendarInvite | null {
  const parts = mail.attachments.filter(
    (a) =>
      a.contentType.toLowerCase() === 'text/calendar' || a.filename?.toLowerCase().endsWith('.ics'),
  );
  for (const part of parts.slice(0, 5)) {
    const invite = parseCalendarInvite(part.content.toString('utf8'));
    if (!invite) continue;
    if (invite.method !== 'PUBLISH' && !invite.dtstamp) continue;
    if (invite.method === 'REPLY') {
      if (
        !own.includes(invite.organizer.toLowerCase()) ||
        invite.attendees.length !== 1 ||
        invite.attendees[0]!.address.toLowerCase() !== sender.toLowerCase()
      )
        continue;
    } else if (invite.organizer && invite.organizer.toLowerCase() !== sender.toLowerCase())
      continue;
    return invite;
  }
  return null;
}
