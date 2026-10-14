import { useState } from 'react';
import type { ContactIdentity } from '@apmail/shared';
import { UserPlus, ContactRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactAssociationDialog } from './contact-association-dialog';
import { ContactEditorDialog } from './contact-form';
export { ContactEditorDialog } from './contact-form';
export function ContactSenderAction({
  email,
  name,
  identity,
}: {
  email: string;
  name: string;
  identity?: ContactIdentity | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {identity ? <ContactRound /> : <UserPlus />}
        {identity ? 'Ver contato' : 'Adicionar aos contatos'}
      </Button>
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
