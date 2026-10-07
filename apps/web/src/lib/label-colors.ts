export const LEGACY_LABEL_COLORS: Record<string, string> = {
  teal: '#CCFBF1',
  blue: '#DBEAFE',
  indigo: '#E0E7FF',
  green: '#DCFCE7',
  amber: '#FEF9C3',
  red: '#FEE2E2',
  slate: '#F1F3F5',
  cyan: '#CFFAFE',
};
export function labelColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : (LEGACY_LABEL_COLORS[value] ?? '#1686A7');
}
export function colorText(value: string) {
  const hex = labelColor(value).slice(1),
    channels = [0, 2, 4]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}
export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}
export function hexToHsv(value: string) {
  const hex = labelColor(value).slice(1),
    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h =
    d === 0
      ? 0
      : (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
