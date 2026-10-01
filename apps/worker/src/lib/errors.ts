export function connectionError(error: unknown, host: string, port: number): string {
  const e = error as {
    code?: string;
    authenticationFailed?: boolean;
    responseCode?: number;
    message?: string;
  };
  if (
    e.authenticationFailed ||
    e.code === 'EAUTH' ||
    e.responseCode === 535 ||
    /authentication|invalid credentials|login failed/i.test(e.message ?? '')
  )
    return 'Usuário ou senha inválidos. Se a conta usa verificação em duas etapas, gere uma senha de aplicativo.';
  if (/CERT|TLS|SSL/i.test(e.code ?? '') || /certificate|TLS|SSL/i.test(e.message ?? ''))
    return 'Falha na conexão segura (TLS). Verifique se a porta e a opção de segurança estão corretas.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ETIMEOUT|ESOCKET/i.test(e.code ?? ''))
    return `Não foi possível conectar a ${host}:${port}. Verifique o servidor e a porta.`;
  return 'Erro inesperado ao acessar a caixa. Tente novamente mais tarde.';
}
export function isConnectionError(error: unknown): boolean {
  const e = error as { code?: string; authenticationFailed?: boolean; message?: string };
  return (
    !!e.authenticationFailed ||
    /EAUTH|ENOTFOUND|ECONN|ETIMEDOUT|ETIMEOUT|ESOCKET|TLS|SSL|CERT|EAI_AGAIN/i.test(e.code ?? '') ||
    /authentication|connection|socket|closed|timeout/i.test(e.message ?? '')
  );
}
