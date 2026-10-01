import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
export type FilterOption = { value: string; label: string };
export function FilterPopover({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={value.length ? 'border-primary bg-secondary text-secondary-foreground' : ''}
        >
          {label}: {value.length || 'todos'}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="mb-2 text-sm font-semibold">{label}</p>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={value.includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked ? [...value, option.value] : value.filter((v) => v !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
        <div className="mt-3 flex justify-between border-t pt-3">
          <Button variant="ghost" size="sm" onClick={() => onChange(options.map((o) => o.value))}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Limpar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
