import { expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { enqueueSecurityScan } from '../../src/security/processor.js';
import { queueHealthCounts } from '../../src/queues.js';

const redisUrl = process.env.REDIS_URL_TEST;
if (!redisUrl || !['6', '7'].includes(new URL(redisUrl).pathname.slice(1)))
  throw Error('Dedicated Redis DB 6/7 required');

it('analisa imagens e anexos antes dos contêineres de importação e MIME bruto', async () => {
  const url = new URL(redisUrl);
  const queue = new Queue('av-priority-' + randomUUID(), {
    connection: { host: url.hostname, port: Number(url.port), db: Number(url.pathname.slice(1)) },
  });
  let worker: Worker | undefined;
  try {
    await enqueueSecurityScan(queue, {
      id: randomUUID(),
      generation: 1,
      status: 'pending',
      kind: 'mail_raw',
    });
    const imageId = randomUUID();
    await enqueueSecurityScan(queue, {
      id: imageId,
      generation: 1,
      status: 'pending',
      kind: 'attachment',
    });
    const jobs = await queue.getJobs(['waiting', 'prioritized']);
    const image = jobs.find((j) => j.data.id === imageId)!;
    const container = jobs.find((j) => j.data.id !== imageId)!;
    expect(image.opts.priority).toBeGreaterThan(0);
    expect(container.opts.priority).toBeGreaterThan(image.opts.priority!);
    expect(await queueHealthCounts(queue)).toEqual({
      waiting: 2,
      active: 0,
      delayed: 0,
      failed: 0,
    });
    const processed: string[] = [];
    await new Promise<void>((resolve, reject) => {
      worker = new Worker(
        queue.name,
        async (job) => {
          processed.push(job.data.id);
        },
        {
          connection: {
            host: url.hostname,
            port: Number(url.port),
            db: Number(url.pathname.slice(1)),
          },
          concurrency: 1,
        },
      );
      worker.on('completed', () => {
        if (processed.length === 2) resolve();
      });
      worker.on('error', reject);
    });
    expect(processed).toEqual([imageId, container.data.id]);
  } finally {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
