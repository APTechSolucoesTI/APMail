import { useId, useState } from 'react';
import { hexToHsv, hsvToHex, labelColor } from '@/lib/label-colors';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    current = hexToHsv(value);
  const [hue, setHue] = useState(current.h),
    [saturation, setSaturation] = useState(current.s);
  const h = current.s > 0 && current.v > 0 ? current.h : hue,
    s = current.v > 0 ? current.s : saturation,
    v = current.v;
  const change = (nextH: number, nextS: number, nextV: number) => {
    setHue(nextH);
    setSaturation(nextS);
    onChange(hsvToHex(nextH, nextS, nextV));
  };
  const position = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    change(
      h,
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    );
  };
  return (
    <div className="space-y-3">
      <div
        className="relative h-40 w-full touch-none rounded-md border border-input"
        aria-hidden="true"
        style={{
          backgroundColor: hsvToHex(h, 1, 1),
          backgroundImage:
            'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          position(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) position(e);
        }}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black"
          style={{ left: s * 100 + '%', top: (1 - v) * 100 + '%' }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id + 'h'}>Matiz</Label>
        <input
          id={id + 'h'}
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.round(h)}
          onChange={(e) => change(Number(e.target.value), s, v)}
          className="h-11 w-full accent-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['Saturação', s, 's'],
          ['Luminosidade', v, 'v'],
        ].map(([text, level, key]) => (
          <div key={String(key)} className="space-y-2">
            <Label htmlFor={id + key}>{text}</Label>
            <input
              id={id + key}
              type="range"
              min={0}
              max={100}
              value={Math.round(Number(level) * 100)}
              onChange={(e) =>
                change(
                  h,
                  key === 's' ? Number(e.target.value) / 100 : s,
                  key === 'v' ? Number(e.target.value) / 100 : v,
                )
              }
              className="h-11 w-full accent-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor={id + 'hex'}>Código hexadecimal</Label>
        <div className="flex items-center gap-2">
          <Input
            id={id + 'hex'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={7}
            placeholder="#1686A7"
            aria-invalid={!/^#[\da-f]{6}$/i.test(value)}
          />
          <input
            type="color"
            value={labelColor(value)}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            aria-label="Abrir seletor de cor do dispositivo"
            className="h-11 w-11 shrink-0 cursor-pointer rounded-md border bg-card"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Escolha no gradiente, use os controles pelo teclado ou informe qualquer cor RGB.
        </p>
      </div>
    </div>
  );
}
