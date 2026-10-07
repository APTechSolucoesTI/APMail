import { expect, it } from 'vitest';
import { colorText, hexToHsv, hsvToHex, labelColor } from './label-colors';
it('conserva qualquer cor RGB e fornece texto com contraste AA', () => {
  for (const value of [
    '#000000',
    '#FFFFFF',
    '#1686A7',
    '#FFFF00',
    '#123456',
    '#FF00FF',
    '#909090',
  ]) {
    const hsv = hexToHsv(value);
    expect(hsvToHex(hsv.h, hsv.s, hsv.v)).toBe(value);
    const rgb = (hex: string) =>
      [0, 2, 4]
        .map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = (hex: string) => {
      const c = rgb(hex);
      return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
    };
    const l1 = lum(value),
      l2 = lum(colorText(value));
    expect((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(labelColor('url(javascript:1)')).toBe('#1686A7');
  expect(labelColor('#abcdef')).toBe('#ABCDEF');
});
