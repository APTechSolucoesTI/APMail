import { spawn } from 'node:child_process';

if (process.platform === 'win32') throw new Error('Esta verificação de sinais exige Linux.');
async function check(entry, ready) {
  const child = spawn(process.execPath, [entry], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    output += data.toString();
  });
  const exit = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })),
  );
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await ready(output)) break;
      if (child.exitCode !== null || attempt === 99)
        throw new Error(`Processo não iniciou: ${entry}. ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill('SIGTERM');
    const result = await Promise.race([
      exit,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Encerramento excedeu 30 s.')), 30000).unref(),
      ),
    ]);
    if (result.code !== 0 || result.signal !== null)
      throw new Error(`Encerramento não gracioso: ${entry} ${JSON.stringify(result)}. ${output}`);
    console.info(`Encerramento gracioso validado: ${entry}`);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
await check('apps/api/dist/server.js', async () => {
  try {
    return (await fetch(`http://127.0.0.1:${process.env.API_PORT ?? 3001}/api/health`)).ok;
  } catch {
    return false;
  }
});
await check('apps/worker/dist/index.js', async (output) => output.includes('Worker iniciado.'));
