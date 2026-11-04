export type OfficeFormat = 'docx' | 'xlsx' | 'csv' | 'ods';
export type OfficeSheet = { name: string; rows: string[][] };
export type OfficePreview =
  | { kind: 'document'; paragraphs: string[]; truncated: boolean }
  | { kind: 'table'; sheets: OfficeSheet[]; truncated: boolean };

const mib = 1024 * 1024;
export const OFFICE_PREVIEW_MAX_BYTES = 12 * mib;
const xmlPartLimit = 4 * mib;
const rowLimit = 200;
const columnLimit = 40;
const sheetLimit = 12;
const cellText = (text: string) => (text.length > 1000 ? text.slice(0, 999) + '…' : text);

export function attachmentOfficeFormat(filename: string, contentType = ''): OfficeFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === 'docx' || ext === 'xlsx' || ext === 'csv' || ext === 'ods') return ext;
  const types: Record<string, OfficeFormat> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'text/csv': 'csv',
    'application/csv': 'csv',
  };
  return types[contentType.split(';')[0]!.trim().toLowerCase()] ?? null;
}

export async function readOfficeBytes(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('office_size_limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Reads only named XML parts. ZIP64, multi-volume and encrypted parts are unsupported. */
function openOfficeZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => {
    throw Error('office_invalid_zip');
  };
  let end = bytes.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (
    end >= minimum &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== bytes.byteLength)
  )
    end--;
  if (end < minimum || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail();
  const count = view.getUint16(end + 10, true),
    directory = view.getUint32(end + 16, true);
  const directoryEnd = directory + view.getUint32(end + 12, true);
  if (count > 4096 || count !== view.getUint16(end + 8, true) || directoryEnd > end) fail();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = new Map<
    string,
    { flags: number; method: number; size: number; compressed: number; local: number }
  >();
  let cursor = directory;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) fail();
    const length = view.getUint16(cursor + 28, true);
    const next =
      cursor + 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (next > directoryEnd) fail();
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + length));
    if (entries.has(name)) fail();
    entries.set(name, {
      flags: view.getUint16(cursor + 8, true),
      method: view.getUint16(cursor + 10, true),
      compressed: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      local: view.getUint32(cursor + 42, true),
    });
    cursor = next;
  }
  let inflated = 0;
  return async (name: string) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const { flags, method, local, size, compressed } = entry;
    if (
      flags & 0x41 ||
      ![0, 8].includes(method) ||
      local + 30 > directory ||
      view.getUint32(local, true) !== 0x04034b50
    )
      fail();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > directory) fail();
    inflated += size;
    if (size > xmlPartLimit || inflated > OFFICE_PREVIEW_MAX_BYTES)
      throw Error('office_size_limit');
    const data = new Uint8Array(bytes.subarray(start, start + compressed));
    const part =
      method === 0
        ? data
        : await readOfficeBytes(
            new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
            size,
          );
    if (part.byteLength !== size) fail();
    return decoder.decode(part);
  };
}

const nodes = (parent: Document | Element, name: string) =>
  Array.from(parent.getElementsByTagNameNS('*', name));
const children = (parent: Element, name: string) =>
  Array.from(parent.children).filter((node) => node.localName === name);
const textOf = (parent: Element, name: string) =>
  nodes(parent, name)
    .map((node) => node.textContent ?? '')
    .join('');
function wordParagraph(paragraph: Element) {
  const content: string[] = [];
  for (const node of nodes(paragraph, '*')) {
    if (node.localName === 't') content.push(node.textContent ?? '');
    if (node.localName === 'br' || node.localName === 'cr') content.push('\n');
    if (node.localName === 'tab') content.push('\t');
  }
  return cellText(content.join(''));
}
function xml(source: string | null) {
  if (source === null || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source))
    throw Error('office_invalid_xml');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (nodes(doc, 'parsererror').length) throw Error('office_invalid_xml');
  return doc;
}

function csvDelimiter(text: string) {
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '\n' || char === '\r') break;
    if (counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}
function csvPreview(bytes: Uint8Array): OfficePreview {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  if (text.includes('\0')) throw Error('office_invalid_csv');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    truncated = false;
  const delimiter = csvDelimiter(text);
  const append = (char: string) => {
    if (field.length < 1001) field += char;
  };
  const pushField = () => {
    if (row.length < columnLimit) row.push(cellText(field));
    else truncated = true;
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (rows.length === rowLimit) {
      truncated = true;
      break;
    }
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        append('"');
        i++;
      } else if (char === '"') quoted = false;
      else append(char);
    } else if (char === '"' && !field) quoted = true;
    else if (char === delimiter) pushField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushField();
      rows.push(row);
      row = [];
    } else append(char);
  }
  if (quoted) throw Error('office_invalid_csv');
  if (row.length || field) {
    pushField();
    rows.push(row);
  }
  return { kind: 'table', sheets: [{ name: 'CSV', rows }], truncated };
}

const odsTable = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const odsOffice = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
function odsPreview(source: string | null): OfficePreview {
  const doc = xml(source);
  const spreadsheet = doc.getElementsByTagNameNS(odsOffice, 'spreadsheet')[0];
  if (!spreadsheet) throw Error('office_invalid_xml');
  const tables = children(spreadsheet, 'table').filter((table) => table.namespaceURI === odsTable);
  let truncated = tables.length > sheetLimit;
  const repeat = (node: Element, attribute: string, maximum: number) => {
    const number = Number(node.getAttributeNS(odsTable, attribute) ?? 1);
    if (!Number.isSafeInteger(number) || number < 1) throw Error('office_invalid_xml');
    if (number > maximum) truncated = true;
    return Math.min(number, maximum);
  };
  const sheets = tables.slice(0, sheetLimit).map((table, index) => {
    const rows: string[][] = [];
    for (const row of nodes(table, 'table-row')) {
      if (rows.length === rowLimit) {
        truncated = true;
        break;
      }
      const values: string[] = [];
      for (const cell of Array.from(row.children)) {
        if (!['table-cell', 'covered-table-cell'].includes(cell.localName)) continue;
        if (values.length === columnLimit) {
          truncated = true;
          break;
        }
        const value =
          nodes(cell, 'p')
            .map((p) => p.textContent ?? '')
            .join('\n') ||
          cell.getAttributeNS(odsOffice, 'value') ||
          '';
        const repeats = repeat(cell, 'number-columns-repeated', columnLimit - values.length);
        for (let i = 0; i < repeats; i++) values.push(cellText(value));
      }
      const repeats = repeat(row, 'number-rows-repeated', rowLimit - rows.length);
      for (let i = 0; i < repeats; i++) rows.push(values);
    }
    return {
      name: cellText(table.getAttributeNS(odsTable, 'name') ?? `Planilha ${index + 1}`),
      rows,
    };
  });
  return { kind: 'table', sheets, truncated };
}

async function xlsxPreview(part: (name: string) => Promise<string | null>): Promise<OfficePreview> {
  const workbook = xml(await part('xl/workbook.xml'));
  const rels = xml(await part('xl/_rels/workbook.xml.rels'));
  const relationships = new Map(
    nodes(rels, 'Relationship').flatMap((rel) => {
      const id = rel.getAttribute('Id'),
        target = rel.getAttribute('Target')?.replace(/^\/?xl\//, '');
      return id &&
        target &&
        rel.getAttribute('TargetMode') !== 'External' &&
        /^worksheets\/[\w.-]+\.xml$/.test(target)
        ? [[id, 'xl/' + target] as const]
        : [];
    }),
  );
  const shared = await part('xl/sharedStrings.xml');
  const strings =
    shared === null ? [] : nodes(xml(shared), 'si').map((si) => cellText(textOf(si, 't')));
  const definitions = nodes(workbook, 'sheet').filter(
    (sheet) => !['hidden', 'veryHidden'].includes(sheet.getAttribute('state') ?? ''),
  );
  const sheets: OfficeSheet[] = [];
  let truncated = definitions.length > sheetLimit;
  for (const definition of definitions.slice(0, sheetLimit)) {
    const id = Array.from(definition.attributes).find((attr) => attr.localName === 'id')?.value;
    const target = id ? relationships.get(id) : undefined;
    if (!target) continue;
    const grid = nodes(xml(await part(target)), 'sheetData')[0];
    if (!grid) continue;
    const source = children(grid, 'row');
    if (source.length > rowLimit) truncated = true;
    const rows = source.slice(0, rowLimit).map((row) => {
      const values: string[] = [];
      for (const cell of children(row, 'c')) {
        const letters = /^[A-Z]+/.exec(cell.getAttribute('r') ?? '')?.[0];
        const index = letters
          ? [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1
          : values.length;
        if (index >= columnLimit) {
          truncated = true;
          continue;
        }
        while (values.length <= index) values.push('');
        const value = children(cell, 'v')[0]?.textContent ?? '';
        const type = cell.getAttribute('t');
        values[index] = cellText(
          type === 's' && /^\d+$/.test(value)
            ? (strings[Number(value)] ?? '')
            : type === 'inlineStr'
              ? textOf(cell, 't')
              : type === 'b'
                ? value === '1'
                  ? 'Sim'
                  : 'Não'
                : value,
        );
      }
      return values;
    });
    sheets.push({
      name: cellText(definition.getAttribute('name') ?? `Planilha ${sheets.length + 1}`),
      rows,
    });
  }
  if (!sheets.length) throw Error('office_no_sheets');
  return { kind: 'table', sheets, truncated };
}

/** Parses data only. The UI displays escaped text and never attaches the XML to the page. */
export async function parseOfficePreview(
  bytes: Uint8Array,
  format: OfficeFormat,
): Promise<OfficePreview> {
  if (bytes.byteLength > OFFICE_PREVIEW_MAX_BYTES) throw Error('office_size_limit');
  if (format === 'csv') return csvPreview(bytes);
  const part = openOfficeZip(bytes);
  if (format === 'xlsx') return xlsxPreview(part);
  if (format === 'ods') return odsPreview(await part('content.xml'));
  const doc = xml(await part('word/document.xml'));
  const body = nodes(doc, 'body')[0];
  if (!body) throw Error('office_invalid_xml');
  const paragraphs = nodes(body, 'p');
  return {
    kind: 'document',
    paragraphs: paragraphs.slice(0, 400).map(wordParagraph),
    truncated: paragraphs.length > 400,
  };
}
