import { Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar registros…',
  debounce = 400,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounce?: number;
}) {
  const id = useId();
  const [state, setState] = useState({ input: value, previous: value, lastSent: value });
  if (state.previous !== value) {
    setState({ ...state, previous: value, input: value === state.lastSent ? state.input : value });
  }
  const input = state.input;
  useEffect(() => {
    if (debounce === 0 || input === value) return;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, lastSent: input }));
      onChange(input);
    }, debounce);
    return () => clearTimeout(timer);
  }, [input, value, onChange, debounce]);
  const clear = () => {
    setState({ input: '', previous: value, lastSent: '' });
    onChange('');
  };
  return (
    <div className="relative min-w-56 flex-1">
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Search
        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        type="search"
        value={input}
        onChange={(event) => {
          const text = event.target.value;
          setState({ ...state, input: text, lastSent: debounce === 0 ? text : state.lastSent });
          if (debounce === 0) onChange(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            clear();
          }
        }}
        placeholder={placeholder}
        className="h-11 pl-9 pr-11 text-sm sm:h-8 sm:text-xs"
      />
      {input && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-0 top-1/2 -translate-y-1/2"
          aria-label="Limpar busca"
          onClick={clear}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
