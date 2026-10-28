import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import sanitizeHtml from 'sanitize-html';
import {
  normalizeSmtpHelloName,
  assertFilesClean,
  Storage,
  scanClamAv,
  antivirusOptions,
} from '@apmail/db';
import type { Resources } from './resources.js';
import type { ConversationPdfMessage } from './conversation-pdf.js';

const maxBytes = 3 * 1024 * 1024;
/** Pin a verified public DNS answer to the connection, including each redirect. */
export async function fetchPdfImage(source: string, redirects = 0): Promise<Buffer> {
  const url = new URL(source);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    redirects > 2
  )
    throw Error('image_url_blocked');
  const answers = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!answers.length || answers.some((a) => !normalizeSmtpHelloName(a.address)))
    throw Error('image_address_blocked');
  const address = answers[0]!;
  return new Promise<Buffer>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        signal: AbortSignal.timeout(4000),
        family: address.family,
        lookup: (_host, _options, done) => done(null, address.address, address.family),
        headers: {
          Accept: 'image/png,image/jpeg,image/gif,image/webp',
          'User-Agent': 'APMail-PDF',
        },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          fetchPdfImage(new URL(response.headers.location, url).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          response.statusCode !== 200 ||
          !/^image\/(png|jpeg|gif|webp)(?:;|$)/i.test(response.headers['content-type'] ?? '')
        ) {
          response.resume();
          reject(Error('image_unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(Error('image_size_limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
export function pdfImageSources(html: string): string[] {
  const sources = new Set<string>();
  sanitizeHtml(html, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src', 'data-apmail-src', 'data-apmail-cid'] },
    transformTags: {
      img: (_tag, attrs) => {
        const source = attrs['data-apmail-cid']
          ? 'cid:' + attrs['data-apmail-cid']
          : (attrs['data-apmail-src'] ?? attrs.src);
        if (source) sources.add(source);
        return { tagName: 'img', attribs: attrs };
      },
    },
  });
  return [...sources].slice(0, 24);
}
export async function conversationPdfImages(
  r: Resources,
  tenantId: string,
  messages: ConversationPdfMessage[],
  attachments: {
    id: string;
    message_id: string;
    content_id: string | null;
    storage_path: string;
    size_bytes: number | string | bigint;
  }[],
) {
  const storage = new Storage(r.env.STORAGE_DIR, r.db),
    cache = new Map<string, Promise<{ data: Buffer; width: number; height: number } | null>>();
  for (const message of messages) {
    message.images = {};
    for (const source of pdfImageSources(message.body_html ?? '')) {
      const key = source.startsWith('cid:') ? message.id + ':' + source : source;
      if (!cache.has(key) && cache.size >= 40) continue;
      if (!cache.has(key))
        cache.set(
          key,
          (async () => {
            try {
              let bytes: Buffer;
              if (source.startsWith('cid:')) {
                const cid = source.slice(4).replace(/^<|>$/g, '');
                const file = attachments.find(
                  (a) => a.message_id === message.id && a.content_id?.replace(/^<|>$/g, '') === cid,
                );
                if (!file || Number(file.size_bytes) > maxBytes) return null;
                await assertFilesClean(r.db, [file.storage_path], storage);
                const chunks: Buffer[] = [];
                for await (const chunk of await storage.openReadStream(file.storage_path))
                  chunks.push(Buffer.from(chunk));
                bytes = Buffer.concat(chunks);
              } else if (
                /^data:image\/(png|jpeg|gif|webp);base64,/i.test(source) &&
                source.length < maxBytes * 1.4
              ) {
                bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
              } else {
                const url = new URL(source, r.env.APP_URL);
                const local =
                  /^\/api\/(?:(?:public\/)?signature-images|signatures\/images)\/([a-f0-9-]{36})$/.exec(
                    url.pathname,
                  );
                if (url.origin === new URL(r.env.APP_URL).origin && local) {
                  const file = await r.db
                    .selectFrom('signature_images')
                    .select(['storage_path', 'size_bytes'])
                    .where('id', '=', local[1]!)
                    .where('tenant_id', '=', tenantId)
                    .executeTakeFirst();
                  if (!file || Number(file.size_bytes) > maxBytes) return null;
                  await assertFilesClean(r.db, [file.storage_path], storage);
                  const chunks: Buffer[] = [];
                  for await (const chunk of await storage.openReadStream(file.storage_path))
                    chunks.push(Buffer.from(chunk));
                  bytes = Buffer.concat(chunks);
                } else {
                  bytes = await fetchPdfImage(url.href);
                  const scan = await scanClamAv(Readable.from(bytes), antivirusOptions(r.env));
                  if (scan.status !== 'clean') return null;
                }
              }
              const normalized = await sharp(bytes, { limitInputPixels: 16000000 })
                .rotate()
                .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer({ resolveWithObject: true });
              return {
                data: normalized.data,
                width: normalized.info.width,
                height: normalized.info.height,
              };
            } catch {
              return null;
            }
          })(),
        );
      const image = await cache.get(key)!;
      if (image) message.images[source] = image;
    }
  }
  return messages;
}
