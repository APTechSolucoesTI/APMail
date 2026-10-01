import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
const brazil = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Recife',
  'America/Fortaleza',
  'America/Belem',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Araguaina',
  'America/Bahia',
  'America/Campo_Grande',
  'America/Maceio',
  'America/Santarem',
];
const others = [
  'UTC',
  ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
].filter((v) => !brazil.includes(v));
export function TimezoneSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={id + '-options'}
          className="w-full justify-between"
        >
          {value || 'Escolha um fuso horário'}
          <ChevronsUpDown aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput aria-label="Buscar fuso horário" placeholder="Buscar cidade ou região…" />
          <CommandList id={id + '-options'}>
            <CommandEmpty>Nenhum fuso encontrado.</CommandEmpty>
            {[
              ['Brasil', brazil],
              ['Outros fusos', others],
            ].map(([name, zones]) => (
              <CommandGroup key={name as string} heading={name as string}>
                {(zones as string[]).map((zone) => (
                  <CommandItem
                    key={zone}
                    value={zone}
                    onSelect={() => {
                      onChange(zone);
                      setOpen(false);
                    }}
                    className="min-h-11 sm:min-h-8"
                  >
                    <span className="flex-1">{zone.replaceAll('_', ' ')}</span>
                    {value === zone && <Check className="size-4" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
