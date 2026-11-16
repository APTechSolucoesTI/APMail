type ConnectionFailure = {
  code?: string;
  authenticationFailed?: boolean;
  responseCode?: number;
  message?: string;
};

function interruptedTransport(error: ConnectionFailure): boolean {
  // Certificate failures must retain their security classification even through ESOCKET.
  if (
    /CERT/i.test(error.code ?? '') ||
    /certificate|self.signed|unable to verify/i.test(error.message ?? '')
  )
    return false;
  return (
    /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ETIMEOUT|ESOCKET|EPIPE|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ERR_SSL_UNEXPECTED_EOF_WHILE_READING)$/i.test(
      error.code ?? '',
    ) ||
    /(?:socket|connection).*(?:closed|reset|timeout|timed out|disconnected)|(?:closed|reset|timeout|timed out|disconnected).*(?:socket|connection)/i.test(
      error.message ?? '',
    )
  );
}

export function connectionError(error: unknown, host: string, port: number): string {
  const e = error as ConnectionFailure;
  const kind = connectionErrorKind(error);
  if (kind === 'authentication')
    return 'Usuário ou senha inválidos. Se a conta usa verificação em duas etapas, gere uma senha de aplicativo.';
  if (kind === 'security')
    return 'Falha na conexão segura (TLS). Verifique se a porta e a opção de segurança estão corretas.';
  if (interruptedTransport(e))
    return `Não foi possível conectar a ${host}:${port}. Verifique o servidor e a porta.`;
  return 'Erro inesperado ao acessar a caixa. Tente novamente mais tarde.';
}
export function isConnectionError(error: unknown): boolean {
  const e = error as { code?: string; authenticationFailed?: boolean; message?: string };
  return (
    interruptedTransport(e) ||
    !!e.authenticationFailed ||
    /EAUTH|ENOTFOUND|ECONN|ETIMEDOUT|ETIMEOUT|ESOCKET|TLS|SSL|CERT|EAI_AGAIN/i.test(e.code ?? '') ||
    /authentication|connection|socket|closed|timeout|conex[aã]o|desconectad|tempo limite/i.test(
      e.message ?? '',
    )
  );
}

export function connectionErrorKind(error: unknown): 'transient' | 'authentication' | 'security' {
  const e = error as ConnectionFailure;
  if (
    e.authenticationFailed ||
    e.code === 'EAUTH' ||
    e.responseCode === 535 ||
    /authentication|invalid credentials|login failed|credencial|credenciais/i.test(e.message ?? '')
  )
    return 'authentication';
  if (interruptedTransport(e)) return 'transient';
  if (/CERT|TLS|SSL/i.test(e.code ?? '') || /certificate|TLS|SSL/i.test(e.message ?? ''))
    return 'security';
  return 'transient';
}

export function connectionRetryDelay(
  attempt: number,
  kind: ReturnType<typeof connectionErrorKind>,
) {
  if (kind === 'authentication') return 30 * 60000;
  if (kind === 'security') return 15 * 60000;
  return [15000, 30000, 60000, 120000, 300000][Math.min(4, Math.max(0, attempt - 1))]!;
}
