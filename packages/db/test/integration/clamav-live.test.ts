import { expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { probeClamAv, scanClamAv } from '../../src/security/clamav.js';

// Explicit opt-in: connects to a real ClamD, never writes a malware test file to disk.
const host = process.env.CLAMAV_TEST_HOST;
it.skipIf(!host)(
  'valida saúde, arquivo limpo e EICAR no ClamD real',
  async () => {
    const options = {
      host: host!,
      port: Number(process.env.CLAMAV_TEST_PORT ?? 3310),
      maxBytes: 25 * 1024 * 1024,
      timeoutMs: 30000,
      connectTimeoutMs: 5000,
      definitionsMaxAgeHours: 168,
    };
    expect(await probeClamAv(options)).toMatchObject({ status: 'online' });
    const clean = await scanClamAv(
      Readable.from(Buffer.from('APMail synthetic clean attachment')),
      options,
    );
    expect(clean).toMatchObject({
      status: 'clean',
      threat_name: null,
      error_code: null,
      size_bytes: 33,
    });
    expect(clean.sha256).toMatch(/^[a-f0-9]{64}$/);
    // Standard, harmless antivirus test signature (not executable malware).
    const eicar = Buffer.from(
      'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
      'base64',
    );
    const infected = await scanClamAv(Readable.from(eicar), options);
    expect(infected.status).toBe('infected');
    expect(infected.threat_name).toContain('Eicar');
    expect(infected.size_bytes).toBe(68);
  },
  90000,
);
