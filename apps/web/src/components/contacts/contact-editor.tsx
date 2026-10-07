import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ContactEditorDialog } from './contact-form';
export { ContactEditorDialog } from './contact-form';
export function ContactSenderAction({ email, name }: { email: string; name: string }) {
  const [editing, setEditing] = useState<{ id?: string } | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const data = await api<{ items: { id: string }[] }>(
              '/contacts?' + new URLSearchParams({ email }),
            );
            setEditing(data.items[0] ? { id: data.items[0].id } : {});
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Falha ao consultar contato.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Contato
      </Button>
      {editing && (
        <ContactEditorDialog
          id={editing.id}
          email={email}
          name={name}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
