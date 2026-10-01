import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
export function ConfirmDialog({
  trigger,
  title,
  description,
  onConfirm,
  pending = false,
  destructive = false,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  description: string;
  onConfirm: () => unknown | Promise<unknown>;
  pending?: boolean;
  destructive?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (value: boolean) => {
    if (busy) return;
    setInternalOpen(value);
    onOpenChange?.(value);
    setError('');
  };
  return (
    <AlertDialog open={open ?? internalOpen} onOpenChange={change}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending || busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || busy}
            className={buttonVariants({ variant: destructive ? 'destructive' : 'default' })}
            onClick={async (event) => {
              event.preventDefault();
              setError('');
              setBusy(true);
              try {
                await onConfirm();
                setInternalOpen(false);
                onOpenChange?.(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {pending || busy ? 'Aguarde…' : 'Confirmar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
