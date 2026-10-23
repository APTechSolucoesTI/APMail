import { useState } from 'react';
import type { ContactIdentity } from '@apmail/shared';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactAssociationDialog } from './contact-association-dialog';
import { ContactEditorDialog } from './contact-form';
import { useAccess } from '@/lib/auth';
export { ContactEditorDialog } from './contact-form';
export function ContactSenderAction({
  email,
  name,
  identity,
  className,
  inlineName = false,
}: {
  email: string;
  name: string;
  identity?: ContactIdentity | null;
  className?: string;
  inlineName?: boolean;
}) {
  const canRead = useAccess('contacts'),
    canCreate = useAccess('contacts.create'),
    canEdit = useAccess('contacts.edit');
  const [open, setOpen] = useState(false);
  if (identity && !canRead)
    return <span className={className}>{identity.name || name || email}</span>;
  if (!identity && (!canRead || (!canCreate && !canEdit))) return null;
  return (
    <>
      {identity && inlineName ? (
        <button
          type="button"
          className={className}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {identity.name || name || email}
        </button>
      ) : (
        <Button variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
          {!identity && <UserPlus />}
          {identity ? identity.name || name || email : 'Adicionar aos contatos'}
        </Button>
      )}
      {open && identity && (
        <ContactEditorDialog
          id={identity.id}
          email={email}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
      {open && !identity && (
        <ContactAssociationDialog
          addresses={[{ address: email, name }]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
