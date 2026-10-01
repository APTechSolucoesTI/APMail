import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from 'dotenv';
export function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return directory;
}
export const resolveWorkspacePath = (path: string) => resolve(workspaceRoot(), path);
export function loadRootEnv(): void {
  config({ path: join(workspaceRoot(), '.env'), quiet: true });
}
loadRootEnv();
