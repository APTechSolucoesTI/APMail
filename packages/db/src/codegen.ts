import './config.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/kysely-codegen/dist/cli/bin.js', import.meta.url)),
    '--dialect',
    'postgres',
    '--out-file',
    'src/types.ts',
    '--overrides',
    JSON.stringify({
      columns: {
        'mailboxes.receiving_protocol': "Generated<'imap' | 'pop3' | 'local'>",
        'contacts.scope': "Generated<'tenant' | 'personal'>",
      },
    }),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
