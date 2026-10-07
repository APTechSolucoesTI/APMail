import { type ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, X, ChevronsUpDown, Plus } from 'lucide-react';
import { isTenantAdmin, canDelegate } from '@apmail/shared';
import { meQuery, useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function useDirectorySearch(value: string) {
  const [term, setTerm] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return term;
}
export function DirectoryHeader({ title, description }: { title: string; description: string }) {
  return (
    <DialogHeader className="shrink-0 border-b p-4 pr-10 text-left sm:p-5 sm:pr-10">
      <DialogTitle className="rounded-xl border-l-4 border-primary bg-secondary px-4 py-3 text-xl font-semibold uppercase tracking-tight text-secondary-foreground">
        {title}
      </DialogTitle>
      <DialogDescription className="pt-1 text-sm">{description}</DialogDescription>
    </DialogHeader>
  );
}
export function PrincipalChips({
  items,
  onPrimary,
  onRemove,
}: {
  items: { key: string; text: string; primary: boolean; info?: ReactNode }[];
  onPrimary: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-start gap-2 rounded-md bg-muted/30 p-2">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-background px-1 text-sm"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 sm:size-8"
            aria-label={'Definir ' + item.text + ' como principal'}
            aria-pressed={item.primary}
            onClick={() => onPrimary(item.key)}
          >
            <Star
              aria-hidden
              className={
                item.primary ? 'size-4 fill-current text-primary' : 'size-4 text-muted-foreground'
              }
            />
          </Button>
          <span className="min-w-0 break-all">
            {item.text}
            {item.primary && <span className="whitespace-nowrap text-primary"> · Principal</span>}
          </span>
          {item.info}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 sm:size-8"
            aria-label={'Remover ' + item.text}
            onClick={() => onRemove(item.key)}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
export function ChannelPicker({
  kind,
  items,
  onAdd,
  onEdit,
  onEditLabel,
  onRemove,
  onPrimary,
  children,
  error,
}: {
  kind: 'email' | 'phone';
  items: { value: string; primary: boolean; label?: string }[];
  onAdd: (value: string) => void;
  onEdit: (index: number, value: string) => void;
  onEditLabel?: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  onPrimary: (index: number) => void;
  children?: ReactNode;
  error?: string;
}) {
  const [value, setValue] = useState(''),
    [open, setOpen] = useState(false);
  const email = kind === 'email',
    label = email ? 'E-mails *' : 'Telefones (opcional)';
  const add = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
    }
  };
  return (
    <section className="min-w-0 space-y-3">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={email ? 'Gerenciar e-mails' : 'Gerenciar telefones'}
            aria-invalid={!!error}
            className="h-11 w-full justify-between font-normal"
          >
            <span>
              {items.length}{' '}
              {email
                ? items.length === 1
                  ? 'e-mail cadastrado'
                  : 'e-mails cadastrados'
                : items.length === 1
                  ? 'telefone cadastrado'
                  : 'telefones cadastrados'}
            </span>
            <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[55dvh] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto"
        >
          <Label htmlFor={'add-' + kind}>{email ? 'Novo e-mail' : 'Novo telefone'}</Label>
          <div className="flex gap-2">
            <Input
              id={'add-' + kind}
              type={email ? 'email' : 'tel'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button
              type="button"
              size="icon"
              aria-label={email ? 'Adicionar e-mail' : 'Adicionar telefone'}
              onClick={add}
              disabled={!value.trim()}
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
          {items.map((item, index) => (
            <div key={index} className="space-y-2">
              <Label htmlFor={kind + '-' + index}>
                {email ? 'E-mail' : 'Telefone'} {index + 1}
              </Label>
              <Input
                id={kind + '-' + index}
                type={email ? 'email' : 'tel'}
                value={item.value}
                onChange={(e) => onEdit(index, e.target.value)}
              />
              {!email && (
                <div className="space-y-2">
                  <Label htmlFor={'phone-title-' + index}>Título do telefone {index + 1}</Label>
                  <Input
                    id={'phone-title-' + index}
                    value={item.label ?? ''}
                    onChange={(e) => onEditLabel?.(index, e.target.value)}
                    maxLength={80}
                  />
                </div>
              )}
            </div>
          ))}
          {children}
          <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(false)}>
            Concluir
          </Button>
        </PopoverContent>
      </Popover>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <PrincipalChips
        items={items.map((item, i) => ({
          key: String(i),
          text: item.label ? item.label + ' · ' + item.value : item.value,
          primary: item.primary,
        }))}
        onPrimary={(key) => onPrimary(Number(key))}
        onRemove={(key) => onRemove(Number(key))}
      />
      <p className="text-sm text-muted-foreground">
        {email ? 'Cadastre ao menos um e-mail.' : 'Telefones são opcionais.'} Use a estrela para
        definir o principal.
      </p>
    </section>
  );
}
export function useDirectoryControl() {
  const me = useQuery(meQuery).data,
    tenantId = useTenantId(),
    tenant = me?.tenants.find((t) => t.id === tenantId);
  return (
    isTenantAdmin(tenant?.role) ||
    canDelegate(tenant?.role ?? null, tenant?.capabilities, 'contacts_manage')
  );
}
