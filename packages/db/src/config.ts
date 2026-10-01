import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from 'dotenv';
export function loadRootEnv(): void {
  let directory = resolve(process.cwd());
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  config({ path: join(directory, '.env'), quiet: true });
}
loadRootEnv();
