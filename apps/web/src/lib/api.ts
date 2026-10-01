export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch('/api' + path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    signal: options.signal,
    ...(options.body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }
      : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = (
      data as { error?: { code?: string; message?: string; details?: Record<string, string[]> } }
    ).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'internal',
      error?.message ?? 'Não foi possível concluir a operação.',
      error?.details,
    );
  }
  return data as T;
}
