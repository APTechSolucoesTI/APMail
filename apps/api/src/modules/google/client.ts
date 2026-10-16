import { z } from 'zod';
import { ApiError } from '../../authz/context.js';
export const GOOGLE_MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().default(3600),
  scope: z.string().default(''),
  token_type: z.string().optional(),
});
export class GoogleClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async json(url: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(
        504,
        'google_timeout',
        'O Google não respondeu a tempo. Confira sua conexão e tente novamente.',
      );
    }
    if (!response.ok)
      throw new ApiError(
        response.status === 401 ? 409 : 502,
        response.status === 401 ? 'google_reconnect' : 'google_error',
        response.status === 401
          ? 'Reconecte sua conta Google nas Integrações.'
          : 'O Google recusou a operação. Confira as permissões e a configuração da integração.',
      );
    return response.json() as Promise<unknown>;
  }
  async token(params: URLSearchParams) {
    return tokensSchema.parse(
      await this.json('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params,
      }),
    );
  }
  async profile(access: string) {
    return z.object({ sub: z.string(), email: z.email(), email_verified: z.boolean() }).parse(
      await this.json('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: 'Bearer ' + access },
      }),
    );
  }
  async meeting(access: string) {
    return z.object({ name: z.string(), meetingUri: z.url() }).parse(
      await this.json('https://meet.googleapis.com/v2/spaces', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' },
        body: JSON.stringify({ config: { accessType: 'TRUSTED' } }),
      }),
    );
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
