import {
  googleTokenSchema,
  googleProfileSchema,
  googleSpaceSchema,
  meetResourceSchema,
  type MeetConfig,
} from '@apmail/shared';
import { isStorageQuotaError, quotaErrors } from '../quotas.js';
export { GOOGLE_MEET_SCOPE, GOOGLE_CALENDAR_SCOPE, GOOGLE_MEET_READ_SCOPE } from '@apmail/shared';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export class GoogleApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(
    readonly providerStatus: number,
    readonly reason: string,
  ) {
    const reconnect = providerStatus === 401 || reason === 'invalid_grant';
    const code = reconnect
      ? 'google_reconnect'
      : providerStatus === 429
        ? 'google_quota'
        : providerStatus === 504
          ? 'google_timeout'
          : 'google_error';
    super(
      reconnect
        ? 'Reconecte sua conta Google em Integrações.'
        : providerStatus === 429
          ? 'O limite temporário do Google foi atingido. A sincronização será retomada.'
          : reason === 'SERVICE_DISABLED'
            ? 'Ative a Google Meet API no projeto Google Cloud.'
            : reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
              ? 'Reautorize o acesso solicitado em Integrações.'
              : providerStatus === 403
                ? 'O Google restringiu esta operação. Verifique a permissão, a conta e as políticas do administrador.'
                : providerStatus === 404
                  ? 'O recurso não está acessível; ele pode ter expirado ou sido removido no Google.'
                  : providerStatus === 504
                    ? 'O Google não respondeu a tempo. Tente novamente.'
                    : 'Não foi possível concluir a operação no Google. Tente novamente.',
    );
    this.code = code;
    this.statusCode = reconnect
      ? 409
      : providerStatus === 429
        ? 429
        : providerStatus === 404
          ? 404
          : providerStatus === 504
            ? 504
            : 502;
  }
}
export function googleFailure(error: unknown): { state: string; code: string; message: string } {
  if (isStorageQuotaError(error))
    return {
      state: 'storage_limited',
      code: 'storage_quota',
      message: quotaErrors[(error as Error).message]!,
    };
  if (!(error instanceof GoogleApiError))
    return {
      state: 'unverified',
      code: 'unexpected',
      message: 'Não foi possível verificar os dados do Google. Tente novamente.',
    };
  return {
    state:
      error.code === 'google_reconnect'
        ? 'permission_required'
        : error.reason === 'SERVICE_DISABLED'
          ? 'configuration_pending'
          : error.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
            ? 'permission_required'
            : error.providerStatus === 404
              ? 'not_found_or_expired'
              : error.providerStatus === 429
                ? 'quota_limited'
                : 'unverified',
    code: error.code === 'google_error' ? error.reason : error.code,
    message: error.message,
  };
}
export class GoogleClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async response(url: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new GoogleApiError(504, 'timeout');
    }
    if (!response.ok) {
      const payload = object(await response.json().catch(() => null)),
        error = payload.error;
      const details = object(error).details;
      const reasons = Array.isArray(details) ? details.map((entry) => object(entry).reason) : [];
      const known = [
        'SERVICE_DISABLED',
        'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        'DOMAIN_POLICY',
        'RATE_LIMIT_EXCEEDED',
      ];
      const reason =
        error === 'invalid_grant'
          ? 'invalid_grant'
          : (reasons.find((v): v is string => typeof v === 'string' && known.includes(v)) ??
            'provider_denied');
      throw new GoogleApiError(response.status, reason);
    }
    return response;
  }
  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.response(url, init);
    return response.status === 204 ? null : (response.json() as Promise<unknown>);
  }
  async noteText(access: string, document: string) {
    if (!/^[\w-]+$/.test(document)) throw new Error('invalid_google_document');
    const response = await this.response(
      'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(document) +
        '/export?mimeType=text%2Fplain',
      { headers: { authorization: 'Bearer ' + access } },
    );
    const text = await response.text();
    if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('google_document_too_large');
    return text;
  }
  token(params: URLSearchParams) {
    return this.json('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    }).then((v) => googleTokenSchema.parse(v));
  }
  profile(access: string) {
    return this.json('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: 'Bearer ' + access },
    }).then((v) => googleProfileSchema.parse(v));
  }
  meeting(access: string, config: MeetConfig = { accessType: 'TRUSTED' }) {
    return this.meet(access, 'spaces', { method: 'POST', body: JSON.stringify({ config }) }).then(
      (v) => googleSpaceSchema.parse(v),
    );
  }
  async meet(access: string, path: string, init: RequestInit = {}, query = new URLSearchParams()) {
    if (!/^(?:spaces|conferenceRecords)(?:\/[a-zA-Z0-9_-]+)*(?::endActiveConference)?$/.test(path))
      throw new Error('invalid_google_resource');
    return this.json('https://meet.googleapis.com/v2/' + path + (query.size ? '?' + query : ''), {
      ...init,
      headers: {
        authorization: 'Bearer ' + access,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  }
  async page<T>(
    access: string,
    path: string,
    key: string,
    schema: { parse(value: unknown): T },
    query = new URLSearchParams(),
  ) {
    const result = object(await this.meet(access, path, {}, query));
    const items = result[key] ?? [];
    if (
      !Array.isArray(items) ||
      items.length > 10000 ||
      (result.nextPageToken &&
        (typeof result.nextPageToken !== 'string' ||
          result.nextPageToken.length > 8192 ||
          result.nextPageToken === query.get('pageToken')))
    )
      throw new Error('invalid_google_response');
    return {
      items: items.map((value) => schema.parse(value)),
      next: typeof result.nextPageToken === 'string' ? result.nextPageToken : null,
    };
  }
  async space(access: string, name: string) {
    meetResourceSchema.parse(name);
    return googleSpaceSchema.parse(await this.meet(access, name));
  }
  async revoke(token: string) {
    await this.fetcher('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  }
}
