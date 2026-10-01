import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { Storage } from '@apmail/db';
import { z } from 'zod';
import { requireAuth, requireTenant, notFound, ApiError } from '../authz/context.js';
import { avatarUrl } from './auth.js';
import type { Resources } from './resources.js';
export async function registerAvatarRoutes(app: FastifyInstance, r: Resources) {
  await app.register(multipart, {
    limits: { fileSize: r.env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  const storage = new Storage(r.env.STORAGE_DIR);
  app.post('/api/me/avatar', async (req) => {
    const c = requireAuth(req.ctx);
    const file = await req.file();
    if (!file || /\.(exe|bat|cmd|com|scr|js|vbs|msi|ps1|sh|jar)$/i.test(file.filename))
      throw new ApiError(400, 'validation_error', 'Escolha uma imagem JPEG, PNG ou WebP.');
    const input = await file.toBuffer();
    if (input.length > 2 * 1024 * 1024)
      throw new ApiError(400, 'validation_error', 'Escolha uma imagem de até 2 MB.');
    const detected = await fileTypeFromBuffer(input);
    if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime))
      throw new ApiError(400, 'validation_error', 'Escolha uma imagem JPEG, PNG ou WebP.');
    const output = await sharp(input, { limitInputPixels: 25000000 })
      .rotate()
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
    const path = `avatars/${c.userId}/${randomUUID()}.webp`;
    const old = await r.db
      .selectFrom('users')
      .select('avatar_path')
      .where('id', '=', c.userId)
      .executeTakeFirstOrThrow();
    await storage.writeFile(path, output);
    const user = await r.db
      .updateTable('users')
      .set({ avatar_path: path })
      .where('id', '=', c.userId)
      .returning(['id', 'avatar_path', 'updated_at'])
      .executeTakeFirstOrThrow();
    if (old.avatar_path) await storage.removeFile(old.avatar_path);
    return { avatar_url: avatarUrl(user) };
  });
  app.delete('/api/me/avatar', async (req) => {
    const c = requireAuth(req.ctx);
    const old = await r.db
      .selectFrom('users')
      .select('avatar_path')
      .where('id', '=', c.userId)
      .executeTakeFirstOrThrow();
    await r.db.updateTable('users').set({ avatar_path: null }).where('id', '=', c.userId).execute();
    if (old.avatar_path) await storage.removeFile(old.avatar_path);
    return { avatar_url: null };
  });
  app.get('/api/avatars/:userId', async (req, reply) => {
    const c = requireTenant(req.ctx);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const user = await r.db
      .selectFrom('users')
      .innerJoin('tenant_members', 'tenant_members.user_id', 'users.id')
      .select('users.avatar_path')
      .where('users.id', '=', userId)
      .where('tenant_members.tenant_id', '=', c.tenantId)
      .where('tenant_members.status', '=', 'active')
      .executeTakeFirst();
    if (!user?.avatar_path) throw notFound();
    return reply
      .type('image/webp')
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await storage.openReadStream(user.avatar_path));
  });
}
