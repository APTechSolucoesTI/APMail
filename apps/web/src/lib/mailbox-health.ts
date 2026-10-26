import type { Mailbox } from './auth';

export function mailboxRecovering(box: Pick<Mailbox, 'status' | 'connection_error_kind'>) {
  return (
    box.status === 'error' &&
    !['authentication', 'security'].includes(box.connection_error_kind ?? '')
  );
}
