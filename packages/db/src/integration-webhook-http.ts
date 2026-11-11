import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { normalizeSmtpHelloName } from './smtp-identity.js';

export function webhookUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('destination_blocked');
  }
  if (
    input.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !normalizeSmtpHelloName(url.hostname)
  )
    throw new Error('destination_blocked');
  return url;
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return (
    'sha256=' +
    createHmac('sha256', secret)
      .update(timestamp + '.' + body)
      .digest('hex')
  );
}

/** Validate every DNS answer and pin the connection; redirects and private destinations are never followed. */
export async function postWebhook(
  destination: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  const url = webhookUrl(destination);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resolved = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('dns_timeout')), 3000);
        }),
      ]).finally(() => clearTimeout(timer));
  if (!resolved.length || resolved.some((ip) => !normalizeSmtpHelloName(ip.address)))
    throw new Error('destination_blocked');
  const address = resolved[0]!;
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        maxHeaderSize: 16384,
        signal: AbortSignal.timeout(10000),
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'APMail-Webhooks/1',
        },
        lookup: (_name, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        resolve(status);
      },
    );
    req.on('error', (error) =>
      reject(new Error(error.name === 'AbortError' ? 'timeout' : 'transport_error')),
    );
    req.end(body);
  });
}
