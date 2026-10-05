import { describe, it, expect } from 'vitest';
import { formatStorageBytes, storagePercentage } from './storage-metering';
describe('bytes exatos e indisponibilidade', () => {
  it('não converte o valor inteiro para Number e preserva bytes acima do limite seguro', () => {
    expect(formatStorageBytes('9007199254740993')).toBe('8,00 PiB');
    expect(formatStorageBytes('1024')).toBe('1,00 KiB');
    expect(formatStorageBytes('-1536')).toBe('-1,50 KiB');
    expect(formatStorageBytes('0')).toBe('0 B');
    expect(formatStorageBytes(null)).toBe('Indisponível');
  });
  it('calcula capacidade e mantém ausências como desconhecidas', () => {
    expect(storagePercentage('81', '100')).toBe(81);
    expect(storagePercentage(null, '100')).toBeNull();
    expect(storagePercentage('0', '0')).toBeNull();
  });
});
