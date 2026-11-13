import { describe, expect, it } from 'vitest';
import {
  parseExternalLaunch,
  readExternalLaunch,
  resolveExternalLaunch,
  validateExternalPath,
} from './external-launch';

const origin = 'https://app.apmail.com.br';
const id = 'aa034af6-fc6b-4e16-8f6e-a9630cfbdf5c';
const open = (path: string) => 'web+apmail://abrir?caminho=' + encodeURIComponent(path);
const search = (link: string) => '?u=' + encodeURIComponent(link);
const pathToMailbox = '/mail/' + id + '?assigned=any';

describe('abertura externa do APMail', () => {
  it.each(['/', pathToMailbox, '/invitations'])('mantém o destino %s', async (path) => {
    const destination = readExternalLaunch(search(open(path)), origin);
    expect(await resolveExternalLaunch(destination, origin)).toBe(path);
  });

  it('lê a rota da caixa quando o Chromium inclui a barra na URL do protocolo', async () => {
    const link = 'web+apmail://abrir/?caminho=' + encodeURIComponent(pathToMailbox);
    expect(await resolveExternalLaunch(readExternalLaunch(search(link), origin), origin)).toBe(
      pathToMailbox,
    );
  });

  it('aceita UUID em maiúsculas e encaminha a mensagem à rota resolvida', async () => {
    const destination = readExternalLaunch(
      search('web+apmail://mensagem/' + id.toUpperCase()),
      origin,
    );
    const messagePath = pathToMailbox + '&thread=' + id;
    expect(
      await resolveExternalLaunch(destination, origin, async (messageId) => {
        expect(messageId).toBe(id);
        return messagePath;
      }),
    ).toBe(messagePath);
  });

  it.each([
    open('https://site.com'),
    open('//site.com'),
    open('/\\site.com'),
    open('javascript:alert(1)'),
    open('/api/integrations/notifications'),
    open('/api'),
    open('/abrir-externo'),
    open('/login'),
    open('/admin'),
    open('/assets/app.js'),
    open('/%2fsite.com'),
    open('/mail/' + id + '/../..'),
    open('/mail/' + id + '/%2e%2e'),
    open('/mail/' + id + '?q=texto%0aoculto'),
    open('/mail/' + id + '?q=texto com espaço'),
    open('/mail/' + id + '?q=%252F%255Csite.com'),
    open('/mail/' + id + '?q=java%2573cript%253Aalert(1)'),
    open('/mail/' + id + '?q=' + 'x'.repeat(2048)),
    'web+apmail://mensagem/123',
    'web+apmail://mensagem/../' + id,
    'web+apmail://mensagem/' + id + '?extra=1',
    'web+apmail://usuario@mensagem/' + id,
    'web+apmail://abrir?caminho=%2F&caminho=%2Fapi',
    'web+apmail://abrir?caminho=%2F#fragmento',
    'web+apmail://abrir/?caminho=%2F%2Fsite.com',
    'web+apmail://abrir/extra?caminho=%2F',
    'web+apmail://abrir//?caminho=%2F',
    'web+apmail://outra-coisa',
    'https://site.com',
  ])('volta ao início quando o link é inválido (%s)', async (link) => {
    expect(await resolveExternalLaunch(readExternalLaunch(search(link), origin), origin)).toBe('/');
  });

  it.each(['', '?u=', '?u=%E0%A4%A', search(open('/')) + '&u=outra'])(
    'rejeita u ausente, ambíguo ou inválido',
    async (query) => {
      expect(await resolveExternalLaunch(readExternalLaunch(query, origin), origin)).toBe('/');
    },
  );

  it('revalida o link guardado no login e o caminho devolvido pelo servidor', async () => {
    expect(parseExternalLaunch(open('//site.com'), origin)).toBeNull();
    const destination = parseExternalLaunch('web+apmail://mensagem/' + id, origin);
    expect(await resolveExternalLaunch(destination, origin, async () => '//site.com')).toBe('/');
    expect(validateExternalPath('/invitations?thread=' + id, origin)).toBe(
      '/invitations?thread=' + id,
    );
  });
});
