import { Blob as NodeBlob } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { attachmentOfficeFormat, parseOfficePreview, readOfficeBytes } from './office-preview';

function zip(
  parts: Record<string, string>,
  { compressed = false, declaredSize }: { compressed?: boolean; declaredSize?: number } = {},
) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, source] of Object.entries(parts)) {
    const filename = Buffer.from(name),
      text = Buffer.from(source),
      data = compressed ? deflateRawSync(text) : text;
    const entry = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    entry.writeUInt32LE(0x04034b50, 0);
    entry.writeUInt16LE(compressed ? 8 : 0, 8);
    entry.writeUInt32LE(data.length, 18);
    entry.writeUInt32LE(text.length, 22);
    entry.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(compressed ? 8 : 0, 10);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(declaredSize ?? text.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(entry, filename, data);
    central.push(directory, filename);
    offset += entry.length + filename.length + data.length;
  }
  const eocd = Buffer.alloc(22),
    centralData = Buffer.concat(central);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(parts).length, 8);
  eocd.writeUInt16LE(Object.keys(parts).length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, eocd]);
}

it('reconhece formatos por extensão com MIME genérico e mantém XLS legado no download', () => {
  expect(attachmentOfficeFormat('Planilha.XLSX', 'application/zip')).toBe('xlsx');
  expect(attachmentOfficeFormat('Relatório.docx', 'application/octet-stream')).toBe('docx');
  expect(attachmentOfficeFormat('planilha.xls', 'application/vnd.ms-excel')).toBeNull();
  expect(attachmentOfficeFormat('arquivo', 'text/csv; charset=utf-8')).toBe('csv');
});

it('mantém aspas, quebras de linha, fórmulas e HTML de CSV como texto', async () => {
  const bytes = new TextEncoder().encode(
    'nome;nota\r\n"Ana; Silva";"linha 1\nlinha ""2"""\r\n=1+2;<img src=x>',
  );
  await expect(parseOfficePreview(bytes, 'csv')).resolves.toEqual({
    kind: 'table',
    sheets: [
      {
        name: 'CSV',
        rows: [
          ['nome', 'nota'],
          ['Ana; Silva', 'linha 1\nlinha "2"'],
          ['=1+2', '<img src=x>'],
        ],
      },
    ],
    truncated: false,
  });
});

it('extrai só o texto de DOCX compactado e bloqueia XML com entidade externa', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  try {
    const part =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Olá &lt;script&gt;</w:t></w:r></w:p></w:body></w:document>';
    await expect(
      parseOfficePreview(
        zip({ 'word/document.xml': part, 'word/vbaProject.bin': 'macro' }, { compressed: true }),
        'docx',
      ),
    ).resolves.toEqual({ kind: 'document', paragraphs: ['Olá <script>'], truncated: false });
    await expect(
      parseOfficePreview(
        zip({
          'word/document.xml':
            '<!DOCTYPE document [<!ENTITY ex SYSTEM "https://example.com/secret">]>' + part,
        }),
        'docx',
      ),
    ).rejects.toMatchObject({ message: 'office_invalid_xml' });
    await expect(
      parseOfficePreview(
        zip({ 'word/document.xml': part }, { compressed: true, declaredSize: 12 }),
        'docx',
      ),
    ).rejects.toMatchObject({ message: 'office_size_limit' });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('exibe somente resultados armazenados do XLSX, sem consultar relações externas', async () => {
  const workbook = zip({
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" r:id="rId1"/><sheet name="Externo" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" TargetMode="External" Target="https://example.com/private"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Valor</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1"><f>WEBSERVICE("https://example.com")</f><v>42</v></c></row></sheetData></worksheet>',
  });
  await expect(parseOfficePreview(workbook, 'xlsx')).resolves.toEqual({
    kind: 'table',
    sheets: [{ name: 'Dados', rows: [['Valor', '', '42']] }],
    truncated: false,
  });
});

it('limita bytes recebidos mesmo sem Content-Length', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel,
  });
  await expect(readOfficeBytes(stream, 4)).rejects.toMatchObject({ message: 'office_size_limit' });
  expect(cancel).toHaveBeenCalledOnce();
});

it('limita expansão de linhas e células repetidas do ODS', async () => {
  const preview = await parseOfficePreview(
    zip({
      'content.xml':
        '<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:x="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><o:body><o:spreadsheet><t:table t:name="Dados"><t:table-row t:number-rows-repeated="1000000"><t:table-cell t:number-columns-repeated="1000000" t:formula="of:=EXTERNAL()"><x:p>42</x:p></t:table-cell></t:table-row></t:table></o:spreadsheet></o:body></o:document-content>',
    }),
    'ods',
  );
  expect(preview).toMatchObject({ kind: 'table', truncated: true });
  if (preview.kind !== 'table') throw Error('Expected table');
  expect(preview.sheets[0]?.rows).toHaveLength(200);
  expect(preview.sheets[0]?.rows[0]).toEqual(Array.from({ length: 40 }, () => '42'));
});
