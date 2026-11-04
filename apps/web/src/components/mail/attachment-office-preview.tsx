import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { LoadingState } from '@/components/data/data-state';
import {
  OFFICE_PREVIEW_MAX_BYTES,
  readOfficeBytes,
  parseOfficePreview,
  type OfficeFormat,
  type OfficePreview,
} from '@/lib/office-preview';

export { attachmentOfficeFormat } from '@/lib/office-preview';

export function AttachmentOfficePreview({
  filename,
  format,
  downloadUrl,
}: {
  filename: string;
  format: OfficeFormat;
  downloadUrl: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const key = `${downloadUrl}:${format}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: OfficePreview; error?: string }>();
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const url = new URL(downloadUrl, window.location.origin);
        if (
          url.origin !== window.location.origin ||
          !/^\/api\/(?:attachments|uploads)\/[^/]+\/download$/.test(url.pathname)
        )
          throw Error('office_unavailable');
        const response = await fetch(url.pathname, {
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw Error('office_unavailable');
        if (Number(response.headers.get('content-length')) > OFFICE_PREVIEW_MAX_BYTES) {
          await response.body.cancel();
          throw Error('office_size_limit');
        }
        const bytes = await readOfficeBytes(response.body, OFFICE_PREVIEW_MAX_BYTES);
        if (controller.signal.aborted) return;
        const data = await parseOfficePreview(bytes, format);
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({
          key,
          error:
            error instanceof Error && error.message === 'office_size_limit'
              ? 'Este arquivo é grande demais para a prévia. Baixe o anexo para ver o conteúdo completo.'
              : 'Não foi possível visualizar este arquivo. Baixe o anexo para abrir em outro aplicativo.',
        });
      }
    };
    void load();
    return () => controller.abort();
  }, [downloadUrl, format, key]);
  const data = current?.data;
  const sheet = data?.kind === 'table' ? (data.sheets[sheetIndex] ?? data.sheets[0]) : undefined;
  const columns = Math.max(0, ...(sheet?.rows.map((row) => row.length) ?? []));
  return (
    <section className="min-w-0 space-y-3" aria-label={'Prévia de ' + filename}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Prévia simplificada do conteúdo.</p>
        <a
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={downloadUrl}
          download={filename}
        >
          <Download />
          Baixar anexo
        </a>
      </div>
      {!current && <LoadingState />}
      {current?.error && (
        <div role="alert" className="space-y-3 rounded-md border p-4 text-sm">
          <p>{current.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((number) => number + 1)}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {data?.kind === 'document' && (
        <div className="max-h-[55dvh] space-y-3 overflow-y-auto rounded-md border bg-card p-4 text-sm">
          {data.paragraphs.some((p) => p.trim()) ? (
            data.paragraphs.map((paragraph, index) => (
              <p key={index} className="min-h-5 whitespace-pre-wrap break-words">
                {paragraph}
              </p>
            ))
          ) : (
            <p className="text-muted-foreground">Nenhum texto disponível para visualizar.</p>
          )}
        </div>
      )}
      {data?.kind === 'table' && (
        <>
          {data.sheets.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Planilha
              <select
                className="h-11 min-w-0 max-w-full rounded-md border border-input bg-card px-3"
                value={sheetIndex}
                onChange={(event) => setSheetIndex(Number(event.target.value))}
              >
                {data.sheets.map((tab, index) => (
                  <option value={index} key={index}>
                    {tab.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sheet?.rows.length && columns ? (
            <div
              className="max-h-[55dvh] overflow-auto rounded-md border"
              tabIndex={0}
              aria-label={'Tabela ' + sheet.name}
            >
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th scope="col" className="border-b p-2">
                      Linha
                    </th>
                    {Array.from({ length: columns }, (_, index) => (
                      <th scope="col" key={index} className="border-b px-3 py-2 text-left">
                        {index < 26
                          ? String.fromCharCode(65 + index)
                          : 'A' + String.fromCharCode(65 + index - 26)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th
                        scope="row"
                        className="border-b bg-muted/40 p-2 text-right tabular-nums text-muted-foreground"
                      >
                        {rowIndex + 1}
                      </th>
                      {Array.from({ length: columns }, (_, index) => (
                        <td
                          key={index}
                          className="max-w-64 border-b px-3 py-2 align-top whitespace-pre-wrap break-words"
                        >
                          {row[index] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma célula disponível para visualizar.
            </p>
          )}
        </>
      )}
      {data?.truncated && (
        <p role="status" className="text-xs text-muted-foreground">
          Exibindo parte do conteúdo. Baixe o arquivo para consultar todos os dados.
        </p>
      )}
    </section>
  );
}
