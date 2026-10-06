import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { Storage, isStorageQuotaError } from '@apmail/db';
import { z } from 'zod';
import { requireAuth, requireTenant, notFound, ApiError } from '../authz/context.js';
import { avatarUrl } from './auth.js';
import type { Resources } from './resources.js';
export async function registerAvatarRoutes(app: FastifyInstance, r: Resources) {
  await app.register(multipart, {
    limits: { fileSize: r.env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  const storage = new Storage(r.env.STORAGE_DIR, r.db);
  app.post('/api/signatures/images', async (req) => {
    const c = requireTenant(req.ctx);
    if (r.env.NODE_ENV === 'production' && !r.env.APP_URL.startsWith('https://'))
      throw new ApiError(
        409,
        'https_required',
        'Configure o endereço HTTPS da aplicação para publicar imagens.',
      );
    const file = await req.file();
    if (!file) throw new ApiError(400, 'validation_error', 'Escolha uma imagem.');
    const input = await file.toBuffer();
    const detected = await fileTypeFromBuffer(input);
    if (
      input.length > 5 * 1024 * 1024 ||
      !detected ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)
    )
      throw new ApiError(400, 'validation_error', 'Escolha JPEG, PNG ou WebP de até 5 MB.');
    let storedPath: string | undefined;
    try {
      const normalized = await sharp(input, { limitInputPixels: 25000000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      const id = randomUUID(),
        path = `signatures/${c.tenantId}/${c.userId}/${id}.png`;
      await storage.writeFile(path, normalized.data);
      storedPath = path;
      await r.db
        .insertInto('signature_images')
        .values({
          id,
          tenant_id: c.tenantId,
          user_id: c.userId,
          storage_path: path,
          content_type: 'image/png',
          width: normalized.info.width,
          height: normalized.info.height,
          size_bytes: normalized.data.length,
          legacy_public: false,
        })
        .execute();
      return {
        id,
        url: `${r.env.APP_URL}/api/signatures/images/${id}`,
        width: normalized.info.width,
        height: normalized.info.height,
      };
    } catch (error) {
      if (storedPath)
        await storage
          .removeFile(storedPath)
          .catch(() => app.log.warn('Limpeza de imagem pendente de reconciliação.'));
      if (isStorageQuotaError(error)) throw error;
      throw new ApiError(400, 'validation_error', 'Não foi possível processar esta imagem.');
    }
  });
  app.get('/api/signatures/images/:id', async (req, reply) => {
    const c = requireTenant(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const row = await r.db
      .selectFrom('signature_images')
      .select(['storage_path', 'content_type'])
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return reply
      .type(row.content_type)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await storage.openReadStream(row.storage_path));
  });
  app.get('/api/public/signature-images/:id', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const row = await r.db
      .selectFrom('signature_images')
      .select(['storage_path', 'content_type'])
      .where('id', '=', id)
      .where('legacy_public', '=', true)
      .executeTakeFirst();
    if (!row) throw notFound();
    return reply
      .type(row.content_type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(await storage.openReadStream(row.storage_path));
  });
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
    let user;
    try {
      user = await r.db
        .updateTable('users')
        .set({ avatar_path: path })
        .where('id', '=', c.userId)
        .returning(['id', 'avatar_path', 'updated_at'])
        .executeTakeFirstOrThrow();
    } catch (error) {
      await storage
        .removeFile(path)
        .catch(() => app.log.warn('Limpeza de avatar pendente de reconciliação.'));
      throw error;
    }
    if (old.avatar_path)
      await storage
        .removeFile(old.avatar_path)
        .catch(() => app.log.warn('Limpeza de avatar anterior pendente de reconciliação.'));
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
