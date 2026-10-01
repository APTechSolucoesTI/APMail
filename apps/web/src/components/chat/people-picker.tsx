import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatPerson } from '@apmail/shared';
import { Check, ChevronsUpDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command';
import { SearchInput } from '@/components/data/search-input';
import { UserAvatar } from '@/components/common/user-avatar';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export function useChatPeople() {
  return useQuery({
    queryKey: ['chat-people', useTenantId()],
    queryFn: ({ signal }) => api<ChatPerson[]>('/members/directory', { signal }),
  });
}
export function PersonCombobox({
  people,
  value,
  onChange,
  label = 'Pessoa',
  invalid,
}: {
  people: ChatPerson[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false),
    id = useId(),
    selected = people.find((p) => p.id === value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-invalid={invalid}
            aria-expanded={open}
            className="min-h-11 w-full justify-between"
          >
            <span className="min-w-0 truncate" title={selected?.full_name}>
              {selected?.full_name ?? 'Escolha uma pessoa'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar pessoa…" aria-label="Buscar pessoa" />
            <CommandList>
              <CommandEmpty>Nenhuma pessoa encontrada.</CommandEmpty>
              {people.map((person) => (
                <CommandItem
                  key={person.id}
                  value={person.id + ' ' + person.full_name}
                  onSelect={() => {
                    onChange(person.id);
                    setOpen(false);
                  }}
                >
                  <span aria-hidden>
                    <UserAvatar name={person.full_name} src={person.avatar_url} size={24} />
                  </span>
                  {person.full_name}
                  {person.id === value && <Check className="ml-auto size-4" aria-hidden />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
export function PeoplePicker({
  people,
  value,
  onChange,
  label = 'Participantes',
  disabled = false,
}: {
  people: ChatPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState(''),
    id = useId();
  const normalized = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
  const rows = people.filter((p) => normalized(p.full_name).includes(normalized(search)));
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        {label} ({value.length})
      </legend>
      <SearchInput
        value={search}
        onChange={setSearch}
        debounce={0}
        placeholder="Buscar participantes…"
      />
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {rows.map((person) => (
          <Label
            key={person.id}
            htmlFor={id + person.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted"
          >
            <Checkbox
              id={id + person.id}
              checked={value.includes(person.id)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...value, person.id] : value.filter((x) => x !== person.id))
              }
            />
            <span aria-hidden>
              <UserAvatar name={person.full_name} src={person.avatar_url} size={24} />
            </span>
            <span className="min-w-0 break-words">{person.full_name}</span>
          </Label>
        ))}
        {!rows.length && (
          <p className="p-4 text-sm text-muted-foreground">Nenhuma pessoa encontrada.</p>
        )}
      </div>
    </fieldset>
  );
}
export function PeopleQueryState({ query }: { query: ReturnType<typeof useChatPeople> }) {
  return query.isLoading ? (
    <LoadingState />
  ) : query.error ? (
    <ErrorState onRetry={() => void query.refetch()} />
  ) : null;
}
