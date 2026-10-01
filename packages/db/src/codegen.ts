import './config.js';
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  'kysely-codegen',
  ['--dialect', 'postgres', '--out-file', 'src/types.ts'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
