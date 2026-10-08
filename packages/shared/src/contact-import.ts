import { contactSchema, type ContactInput } from './contacts.js';
import { normalizeRuleText } from './rules.js';
export type ImportRow = {
  row: number;
  data: unknown;
  errors: string[];
  warnings?: string[];
  duplicate?: 'new' | 'existing' | 'ambiguous' | 'file';
};
export const OUTLOOK_FIELDS = [
  'name',
  'first_name',
  'middle_name',
  'last_name',
  'prefix',
  'suffix',
  'company',
  'job_title',
  'department',
  'office',
  'email',
  'email2',
  'email3',
  'phone',
  'mobile',
  'home_phone',
  'notes',
  'website',
  'birthday',
  'street',
  'city',
  'state',
  'cep',
  'country',
  'home_street',
  'home_city',
  'home_state',
  'home_cep',
  'home_country',
] as const;
export type OutlookField = (typeof OUTLOOK_FIELDS)[number];
const aliases: Record<string, OutlookField> = {
  'full name': 'name',
  'nome completo': 'name',
  'display name': 'name',
  'nome de exibicao': 'name',
  name: 'name',
  nome: 'first_name',
  'first name': 'first_name',
  'middle name': 'middle_name',
  'nome do meio': 'middle_name',
  'last name': 'last_name',
  sobrenome: 'last_name',
  title: 'prefix',
  prefixo: 'prefix',
  suffix: 'suffix',
  sufixo: 'suffix',
  company: 'company',
  empresa: 'company',
  'job title': 'job_title',
  cargo: 'job_title',
  department: 'department',
  departamento: 'department',
  'office location': 'office',
  escritorio: 'office',
  'e mail address': 'email',
  'email address': 'email',
  'e mail': 'email',
  email: 'email',
  'endereco de email': 'email',
  'endereco de e mail': 'email',
  'e mail 2 address': 'email2',
  'e mail 3 address': 'email3',
  'business phone': 'phone',
  'telefone comercial': 'phone',
  'mobile phone': 'mobile',
  celular: 'mobile',
  'telefone celular': 'mobile',
  'home phone': 'home_phone',
  'telefone residencial': 'home_phone',
  notes: 'notes',
  observacoes: 'notes',
  'web page': 'website',
  'pagina da web': 'website',
  birthday: 'birthday',
  aniversario: 'birthday',
  'business street': 'street',
  'rua comercial': 'street',
  'business city': 'city',
  'cidade comercial': 'city',
  'business state': 'state',
  'estado comercial': 'state',
  'business postal code': 'cep',
  'cep comercial': 'cep',
  'business country/region': 'country',
  'pais regiao comercial': 'country',
  'home street': 'home_street',
  'rua residencial': 'home_street',
  'home city': 'home_city',
  'cidade residencial': 'home_city',
  'home state': 'home_state',
  'estado residencial': 'home_state',
  'home postal code': 'home_cep',
  'cep residencial': 'home_cep',
  'home country/region': 'home_country',
};
const header = (s: string) =>
  normalizeRuleText(s).replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
export function parseContactCsv(text: string) {
  const content = text.replace(/^\uFEFF/, ''),
    first = content.split(/\r?\n/, 1)[0] ?? '';
  const count = (sep: string) => {
    let n = 0,
      quote = false;
    for (let i = 0; i < first.length; i++) {
      if (first[i] === '"') quote = !quote;
      else if (!quote && first[i] === sep) n++;
    }
    return n;
  };
  const separator = count(';') > count(',') ? ';' : ',';
  const records: string[][] = [];
  let row: string[] = [],
    value = '',
    quote = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (c === '"') {
      if (quote && content[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quote || !value) quote = !quote;
      else throw Error('CSV contém aspas inválidas.');
    } else if (c === separator && !quote) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && content[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v.trim())) records.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quote) throw Error('CSV contém um campo sem fechar aspas.');
  if (value || row.length) {
    row.push(value);
    if (row.some((v) => v.trim())) records.push(row);
  }
  if (records.length > 10001) throw Error('O limite é de 10.000 contatos por arquivo.');
  const headers = records.shift() ?? [];
  if (!headers.length || headers.length > 200) throw Error('Cabeçalho CSV inválido.');
  if (records.some((r) => r.length !== headers.length))
    throw Error('CSV contém linhas com quantidade diferente de colunas.');
  const mapping = Object.fromEntries(headers.map((h, i) => [String(i), aliases[header(h)] ?? '']));
  return { headers, records, mapping };
}
function validate(data: unknown, row: number): ImportRow {
  const parsed = contactSchema.safeParse(data);
  return {
    row,
    data: parsed.success ? parsed.data : data,
    errors: parsed.success
      ? []
      : parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
  };
}
const date = (v: string) => {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
};
export function mapContactCsv(
  csv: ReturnType<typeof parseContactCsv>,
  mapping: Record<string, string>,
): ImportRow[] {
  for (const [index, field] of Object.entries(mapping)) {
    if (
      !/^\d+$/.test(index) ||
      Number(index) >= csv.headers.length ||
      (field && !OUTLOOK_FIELDS.includes(field as OutlookField))
    )
      throw Error('Mapeamento de colunas inválido.');
  }
  const selected = Object.values(mapping).filter(Boolean);
  if (new Set(selected).size !== selected.length)
    throw Error('Cada campo de destino só pode receber uma coluna.');
  return csv.records.map((record, index) => {
    const v: Record<string, string> = {};
    for (const [i, field] of Object.entries(mapping))
      if (field) v[field] = record[Number(i)]!.trim();
    const emails = ['email', 'email2', 'email3'].flatMap((key) =>
      v[key] ? [{ email: v[key], label: key, is_primary: key === 'email' }] : [],
    );
    const phones = ['phone', 'mobile', 'home_phone'].flatMap((key) =>
      v[key]
        ? [
            {
              number: v[key],
              label: (
                { phone: 'Comercial', mobile: 'Celular', home_phone: 'Residencial' } as Record<
                  string,
                  string
                >
              )[key],
              is_primary: false,
            },
          ]
        : [],
    );
    const addresses = ['', 'home_'].flatMap((prefix) =>
      ['street', 'city', 'state', 'cep', 'country'].some((k) => v[prefix + k])
        ? [
            {
              type: prefix ? 'home' : 'work',
              street: v[prefix + 'street'] ?? '',
              city: v[prefix + 'city'] ?? '',
              state: v[prefix + 'state'] ?? '',
              cep: v[prefix + 'cep'] ?? '',
              country: v[prefix + 'country'] ?? '',
            },
          ]
        : [],
    );
    return validate(
      {
        ...v,
        name: v.name || [v.first_name, v.middle_name, v.last_name].filter(Boolean).join(' '),
        birthday: date(v.birthday ?? ''),
        phone: '',
        emails,
        phones,
        addresses,
      },
      index + 2,
    );
  });
}
function split(value: string, delimiter: string) {
  const parts: string[] = [];
  let part = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      part += value[i] + value[++i]!;
    } else if (value[i] === delimiter) {
      parts.push(part);
      part = '';
    } else part += value[i];
  }
  parts.push(part);
  return parts;
}
const unescape = (value: string) =>
  value.replace(/\\([nN,;\\])/g, (_, c: string) => (c.toLowerCase() === 'n' ? '\n' : c));
export function parseContactVcf(text: string): ImportRow[] {
  const lines = text
      .replace(/^\uFEFF/, '')
      .replace(/\r?\n[ \t]/g, '')
      .split(/\r?\n/),
    rows: ImportRow[] = [];
  let fields: Record<string, unknown> | null = null,
    emails: ContactInput['emails'] = [],
    phones: ContactInput['phones'] = [],
    addresses: unknown[] = [],
    version = '',
    ignored = new Set<string>();
  for (const line of lines) {
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (fields) throw Error('vCard contém cartões sobrepostos.');
      fields = {};
      emails = [];
      phones = [];
      addresses = [];
      version = '';
      ignored = new Set();
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (!fields || !['3.0', '4.0'].includes(version)) throw Error('Use vCard 3.0 ou 4.0.');
      fields.name ||= [
        fields.prefix,
        fields.first_name,
        fields.middle_name,
        fields.last_name,
        fields.suffix,
      ]
        .filter(Boolean)
        .join(' ');
      rows.push({
        ...validate({ ...fields, emails, phones, addresses }, rows.length + 1),
        warnings: ignored.size ? ['Propriedades não importadas: ' + [...ignored].join(', ')] : [],
      });
      fields = null;
      if (rows.length > 10000) throw Error('O limite é de 10.000 contatos por arquivo.');
      continue;
    }
    if (!fields) throw Error('Arquivo vCard inválido.');
    const colon = line.indexOf(':');
    if (colon < 0) throw Error('Propriedade vCard inválida.');
    const meta = line.slice(0, colon),
      name = meta.split(';')[0]!.replace(/^.*\./, '').toUpperCase(),
      raw = line.slice(colon + 1),
      value = unescape(raw);
    if (/ENCODING=QUOTED-PRINTABLE/i.test(meta))
      throw Error('Exporte o vCard 3.0/4.0 em UTF-8, sem quoted-printable.');
    const label = /TYPE=([^;:]+)/i.exec(meta)?.[1]?.replaceAll('"', '') ?? '',
      primary = /PREF=1(?:;|$)|TYPE=[^;]*PREF/i.test(meta);
    if (name === 'VERSION') version = value;
    else if (name === 'FN') fields.name = value;
    else if (name === 'N') {
      const n = split(raw, ';').map(unescape);
      Object.assign(fields, {
        last_name: n[0] ?? '',
        first_name: n[1] ?? '',
        middle_name: n[2] ?? '',
        prefix: n[3] ?? '',
        suffix: n[4] ?? '',
      });
    } else if (name === 'EMAIL')
      emails.push({ email: value.replace(/^mailto:/i, ''), label, is_primary: primary });
    else if (name === 'TEL')
      phones.push({ number: value.replace(/^tel:/i, ''), label, is_primary: primary });
    else if (name === 'ORG') {
      const parts = split(raw, ';').map(unescape);
      fields.company = parts[0] ?? '';
      fields.department = parts.slice(1).join(' / ');
    } else if (name === 'TITLE') fields.job_title = value;
    else if (name === 'NOTE') fields.notes = value;
    else if (name === 'URL') fields.website = value;
    else if (name === 'BDAY')
      fields.birthday = /^\d{8}$/.test(value)
        ? value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6)
        : value;
    else if (name === 'ADR') {
      const a = split(raw, ';').map(unescape);
      addresses.push({
        type: /work/i.test(label) ? 'work' : /home/i.test(label) ? 'home' : 'other',
        complement: [a[0], a[1]].filter(Boolean).join(' '),
        street: a[2] ?? '',
        city: a[3] ?? '',
        state: a[4] ?? '',
        cep: a[5] ?? '',
        country: a[6] ?? '',
      });
    } else if (!['PRODID', 'REV', 'UID'].includes(name)) ignored.add(name);
  }
  if (fields) throw Error('vCard sem END:VCARD.');
  if (!rows.length) throw Error('Nenhum contato encontrado.');
  return rows;
}
