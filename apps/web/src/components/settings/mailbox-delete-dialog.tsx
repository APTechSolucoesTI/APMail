import { useId, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function MailboxDeleteDialog({
  mailbox,
  onClose,
  onDeleted,
}: {
  mailbox: Mailbox;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const id = useId();
  const [step, setStep] = useState(1),
    [email, setEmail] = useState(''),
    [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Excluir caixa e todo o seu conteúdo?' : 'Confirme a exclusão definitiva'}
          </DialogTitle>
          <DialogDescription>
            Etapa {step} de 2 · {mailbox.email_address}
          </DialogDescription>
        </DialogHeader>
        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-sm">
              Todos os e-mails, anexos, pastas, rascunhos, envios e backups importados desta caixa
              serão apagados do APMail. A sincronização será interrompida. Os e-mails no provedor
              permanecem; esta ação não apaga dados no servidor IMAP ou POP3.
            </p>
            <div className="space-y-3 rounded-lg border bg-muted p-4">
              <h2 className="text-base font-semibold">Exporte o histórico antes de continuar</h2>
              <p className="text-sm text-muted-foreground">
                O backup inclui mensagens e anexos que ainda estão salvos no APMail, inclusive
                conteúdos excluídos ainda não limpos. Para IMAP, inclui apenas o que já foi
                sincronizado. Aguarde o download terminar e confira o arquivo.
              </p>
              <div className="flex flex-wrap gap-2">
                {(['mbox', 'eml'] as const).map((format) => (
                  <Button asChild variant="outline" key={format}>
                    <a
                      href={`/api/mailboxes/${mailbox.id}/archive-export?format=${format}&include_deleted=true`}
                    >
                      <Download aria-hidden />
                      {format === 'mbox' ? 'Baixar MBOX' : 'Baixar ZIP com EML'}
                    </a>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Ambos podem ser reimportados no APMail. A exportação para PST ainda não está
                disponível. Filas, etiquetas e atribuições não fazem parte destes arquivos de
                e-mail.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-destructive">
              Esta operação é irreversível. Os conteúdos serão apagados e o espaço será liberado
              conforme a limpeza dos arquivos concluir. Registros de auditoria permanecem.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={id + '-email'}>
                Digite {mailbox.email_address} para confirmar
              </label>
              <Input
                id={id + '-email'}
                value={email}
                disabled={busy}
                autoComplete="off"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id={id + '-ack'}
                checked={acknowledged}
                disabled={busy}
                onCheckedChange={(v) => setAcknowledged(v === true)}
              />
              <label htmlFor={id + '-ack'} className="text-sm">
                Conferi meu backup ou decidi prosseguir sem ele. Confirmo que desejo apagar
                definitivamente todo o conteúdo desta caixa.
              </label>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)}>Continuar para confirmação</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setStep(1)}>
                Voltar ao backup
              </Button>
              <Button
                variant="destructive"
                disabled={
                  busy ||
                  !acknowledged ||
                  email.trim().toLowerCase() !== mailbox.email_address.toLowerCase()
                }
                onClick={async () => {
                  setError('');
                  setBusy(true);
                  try {
                    await api('/mailboxes/' + mailbox.id, {
                      method: 'DELETE',
                      body: { confirm: true, confirmed_email: email.trim() },
                    });
                    toast.success(
                      'Caixa removida. Acompanhe a exclusão definitiva dos conteúdos na listagem.',
                    );
                    await onDeleted();
                    onClose();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Não foi possível excluir a caixa.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 aria-hidden />
                {busy ? 'Excluindo…' : 'Apagar caixa e conteúdos'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
