import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { MAIL_MESSAGE_MAX_BYTES } from '@apmail/shared';

type PopOptions = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  allowInsecure?: boolean;
  timeout?: number;
};
/** RFC 1939 client. UIDL is required for deduplication; never issues DELE. */
export class Pop3Client {
  private socket?: Socket | TLSSocket;
  private buffer = Buffer.alloc(0);
  private failure?: Error;
  private wake?: () => void;
  constructor(private readonly options: PopOptions) {}
  private bind(socket: Socket | TLSSocket) {
    this.socket = socket;
    socket.setTimeout(this.options.timeout ?? 30000, () =>
      socket.destroy(new Error('Tempo limite POP3.')),
    );
    socket.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      if (this.buffer.length > MAIL_MESSAGE_MAX_BYTES + 65536)
        socket.destroy(new Error('Mensagem POP3 acima de 50 MiB.'));
      this.wake?.();
    });
    socket.on('error', (error: Error) => {
      this.failure = error;
      this.wake?.();
    });
    socket.on('close', () => {
      this.failure ??= new Error('Conexão POP3 encerrada.');
      this.wake?.();
    });
  }
  private async line(): Promise<Buffer> {
    for (;;) {
      const offset = this.buffer.indexOf('\r\n');
      if (offset >= 0) {
        const line = this.buffer.subarray(0, offset);
        this.buffer = this.buffer.subarray(offset + 2);
        return line;
      }
      if (this.failure) throw this.failure;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
  async connect() {
    const o = this.options;
    for (const value of [o.username, o.password])
      if (/[\r\n]/.test(value)) throw new Error('Credenciais POP3 inválidas.');
    const socket = o.secure
      ? tlsConnect({
          host: o.host,
          port: o.port,
          servername: o.host,
          rejectUnauthorized: !o.allowInsecure,
        })
      : tcpConnect({ host: o.host, port: o.port });
    this.bind(socket);
    if (!(await this.line()).toString('ascii').startsWith('+OK'))
      throw new Error('Servidor POP3 recusou a conexão.');
    if (!o.secure && !o.allowInsecure) {
      await this.command('STLS');
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      socket.setTimeout(0);
      this.bind(tlsConnect({ socket, servername: o.host, rejectUnauthorized: true }));
      await new Promise<void>((resolve, reject) => {
        this.socket!.once('secureConnect', resolve);
        this.socket!.once('error', reject);
      });
    }
    await this.command('USER ' + o.username);
    await this.command('PASS ' + o.password);
  }
  private async command(command: string) {
    if (!this.socket || this.failure) throw this.failure ?? new Error('POP3 desconectado.');
    this.socket.write(command + '\r\n');
    const response = (await this.line()).toString('ascii');
    if (!response.startsWith('+OK')) throw new Error('Servidor POP3 recusou a operação.');
    return response;
  }
  private async multiline(command: string, maximum = MAIL_MESSAGE_MAX_BYTES) {
    await this.command(command);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      let line = await this.line();
      if (line.length === 1 && line[0] === 46) break;
      if (line[0] === 46 && line[1] === 46) line = line.subarray(1);
      bytes += line.length + 2;
      if (bytes > maximum) {
        this.close();
        throw new Error('Resposta POP3 excede o tamanho permitido.');
      }
      chunks.push(line, Buffer.from('\r\n'));
    }
    return Buffer.concat(chunks);
  }
  async list() {
    const ids = (await this.multiline('UIDL', 16 * 1024 ** 2))
      .toString('ascii')
      .trim()
      .split('\r\n')
      .filter(Boolean);
    const sizes = new Map(
      (await this.multiline('LIST', 16 * 1024 ** 2))
        .toString('ascii')
        .trim()
        .split('\r\n')
        .filter(Boolean)
        .map((line) => {
          const [n, s] = line.split(/\s+/);
          return [Number(n), Number(s)] as const;
        }),
    );
    const seen = new Set<string>();
    return ids.map((line) => {
      const [n, uid] = line.split(/\s+/);
      const number = Number(n),
        size = sizes.get(number);
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        !uid ||
        uid.length > 255 ||
        seen.has(uid) ||
        !Number.isSafeInteger(size) ||
        size! < 0
      )
        throw new Error('UIDL/LIST POP3 inválido.');
      seen.add(uid);
      return { number, uid, size: size! };
    });
  }
  retrieve(number: number) {
    if (!Number.isInteger(number) || number < 1) throw new Error('Mensagem POP3 inválida.');
    return this.multiline('RETR ' + number);
  }
  async quit() {
    try {
      await this.command('QUIT');
    } finally {
      this.close();
    }
  }
  close() {
    this.socket?.destroy();
  }
}
