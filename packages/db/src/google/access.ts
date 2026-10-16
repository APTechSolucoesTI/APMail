import type { Kysely } from 'kysely';
import type { DB } from '../types.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { GoogleApiError, GoogleClient } from './client.js';
export type GoogleEnvironment = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CREDENTIALS_ENCRYPTION_KEY: string;
};
export type GoogleOwner = { tenantId: string; userId: string };
export function readGoogleTokens(
  encrypted: string,
  key: string,
): { access_token: string; refresh_token?: string } {
  const value: unknown = JSON.parse(decryptSecret(encrypted, key));
  if (
    !value ||
    typeof value !== 'object' ||
    !('access_token' in value) ||
    typeof value.access_token !== 'string' ||
    ('refresh_token' in value && typeof value.refresh_token !== 'string')
  )
    throw new Error('invalid_google_credentials');
  return value as { access_token: string; refresh_token?: string };
}
export async function googleAccessToken(
  db: Kysely<DB>,
  env: GoogleEnvironment,
  owner: GoogleOwner,
  required: string | readonly string[],
  google = new GoogleClient(),
) {
  const result = await db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('google_connections')
      .selectAll()
      .where('tenant_id', '=', owner.tenantId)
      .where('user_id', '=', owner.userId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !row ||
      !(Array.isArray(required) ? required : [required]).some((scope) => row.scopes.includes(scope))
    )
      throw new GoogleApiError(401, 'missing_scope');
    const token = readGoogleTokens(row.encrypted_tokens, env.CREDENTIALS_ENCRYPTION_KEY);
    if (+row.expires_at > Date.now() + 60000)
      return { access: token.access_token, scopes: row.scopes };
    if (!token.refresh_token || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
      throw new GoogleApiError(401, 'missing_refresh');
    const refreshed = await google.token(
      new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
      }),
    );
    const scopes = refreshed.scope ? refreshed.scope.split(' ').filter(Boolean) : row.scopes;
    await tx
      .updateTable('google_connections')
      .set({
        encrypted_tokens: encryptSecret(
          JSON.stringify({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token ?? token.refresh_token,
          }),
          env.CREDENTIALS_ENCRYPTION_KEY,
        ),
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000),
        scopes,
        updated_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();
    return { access: refreshed.access_token, scopes };
  });
  if (
    !(Array.isArray(required) ? required : [required]).some((scope) =>
      result.scopes.includes(scope),
    )
  )
    throw new GoogleApiError(401, 'missing_scope');
  return result.access;
}
