import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { OUTLOOK_FIELDS, type ImportRow } from '@apmail/shared';
import { useTenantId, useUserId } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { listQuerySchema } from '@apmail/shared';
type Preview = {
  id: string;
  mode: 'tenant' | 'personal';
  total: number;
  valid: number;
  rows: ImportRow[];
  headers?: string[];
  mapping?: Record<string, string>;
};
type Result = { row: number; status: string; message: string };
const fieldLabels: Record<string, string> = {
  name: 'Nome completo',
  first_name: 'Nome',
  middle_name: 'Nome do meio',
  last_name: 'Sobrenome',
  prefix: 'Prefixo',
  suffix: 'Sufixo',
  company: 'Empresa',
  job_title: 'Cargo',
  department: 'Departamento',
  office: 'Escritório',
  email: 'E-mail principal',
  email2: 'Segundo e-mail',
  email3: 'Terceiro e-mail',
  phone: 'Telefone comercial',
  mobile: 'Celular',
  home_phone: 'Telefone residencial',
  notes: 'Observações',
  website: 'Site',
  birthday: 'Aniversário',
  street: 'Rua comercial',
  city: 'Cidade comercial',
  state: 'Estado comercial',
  cep: 'CEP comercial',
  country: 'País comercial',
  home_street: 'Rua residencial',
  home_city: 'Cidade residencial',
  home_state: 'Estado residencial',
  home_cep: 'CEP residencial',
  home_country: 'País residencial',
};
const resultLabels: Record<string, string> = {
  created: 'Criado',
  updated: 'Atualizado',
  skipped: 'Ignorado',
  invalid: 'Inválido',
  ambiguous: 'Revisão necessária',
};
export function ContactImportDialog({ onClose }: { onClose: () => void }) {
  const stop = useRef(false);
  const [importing, setImporting] = useState(false);
  const client = useQueryClient(),
    [file, setFile] = useState<File | null>(null),
    [encoding, setEncoding] = useState('utf-8'),
    [content, setContent] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [duplicates, setDuplicates] = useState<'skip' | 'update'>('skip'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ cursor: number; total: number; results: Result[] } | null>(
      null,
    ),
    [query, setQuery] = useState(listQuerySchema.parse({})),
    [jobsQuery, setJobsQuery] = useState(listQuerySchema.parse({})),
    [reportQuery, setReportQuery] = useState(listQuerySchema.parse({}));
  const imports = useQuery({
    queryKey: ['contact-imports', useTenantId(), useUserId()],
    queryFn: () =>
      api<{ items: { id: string; cursor: number; total: number; created_at: string }[] }>(
        '/contacts/imports',
      ),
  });
  const resume = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const saved = await api<
        Preview & { cursor: number; results: Result[]; duplicates: 'skip' | 'update' | null }
      >('/contacts/import/' + id);
      setPreview(saved);
      setResult(saved);
      setDuplicates(saved.duplicates ?? 'skip');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const read = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('O limite é de 10 MiB por arquivo.');
      const text = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer());
      setContent(text);
      const data = await api<Preview>('/contacts/import/preview', {
        method: 'POST',
        body: { format: file.name.toLowerCase().endsWith('.vcf') ? 'vcf' : 'csv', content: text },
      });
      setPreview(data);
      setMapping(data.mapping ?? {});
      setResult(null);
      void imports.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remap = async () => {
    setBusy(true);
    setError('');
    try {
      setPreview(
        await api<Preview>('/contacts/import/preview', {
          method: 'POST',
          body: { format: 'csv', content, mapping },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!preview || busy) return;
    stop.current = false;
    setImporting(true);
    setBusy(true);
    setError('');
    try {
      let response;
      do {
        response = await api<{ cursor: number; total: number; results: Result[] }>(
          '/contacts/import/' + preview.id + '/confirm',
          { method: 'POST', body: { duplicates } },
        );
        setResult(response);
      } while (response.cursor < response.total && !stop.current);
      await Promise.all(
        ['contacts', 'global-search', 'contact-suggestions', 'contact-autocomplete'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      if (preview) {
        try {
          const saved = await api<{ cursor: number; total: number; results: Result[] }>(
            '/contacts/import/' + preview.id,
          );
          setResult(saved);
        } catch {
          /* keep the last known progress */
        }
      }
      setError(
        (e as Error).message +
          ' A importação preserva o progresso; use Continuar após corrigir o problema.',
      );
    } finally {
      setBusy(false);
      setImporting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar contatos do Outlook</DialogTitle>
          <DialogDescription>
            CSV ou vCard 3.0/4.0. Até 10 MiB e 10.000 contatos. Revise os campos antes de confirmar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            className="text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            href="/examples/contacts-outlook.csv"
            download
          >
            Baixar exemplo CSV
          </a>
          <a
            className="text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            href="/examples/contacts-outlook.vcf"
            download
          >
            Baixar exemplo VCF
          </a>
        </div>
        {!preview && !!imports.data?.items.length && (
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Importações recentes (disponíveis por 24 horas)
            </summary>
            <ConfigurableTable
              listKey="contact-import-recent-jobs"
              mode="client"
              query={jobsQuery}
              onQueryChange={setJobsQuery}
              data={imports.data.items}
              columns={[
                {
                  id: 'created_at',
                  header: 'Data e hora',
                  hideable: false,
                  cell: (job) => new Date(job.created_at).toLocaleString('pt-BR'),
                },
                { id: 'cursor', header: 'Processados', align: 'right' },
                { id: 'total', header: 'Total', align: 'right' },
              ]}
              rowActions={(job) => (
                <Button variant="outline" disabled={busy} onClick={() => void resume(job.id)}>
                  Retomar/ver relatório
                </Button>
              )}
            />
          </details>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contacts-file">Arquivo CSV ou VCF</Label>
            <Input
              id="contacts-file"
              type="file"
              accept=".csv,.vcf"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contacts-encoding">Codificação do arquivo</Label>
            <select
              id="contacts-encoding"
              className="h-11 w-full rounded-md border bg-background px-3"
              disabled={busy}
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
            >
              <option value="utf-8">UTF-8 (recomendado)</option>
              <option value="windows-1252">Windows-1252 (CSV antigo)</option>
            </select>
          </div>
        </div>
        <Button disabled={!file || busy} onClick={() => void read()}>
          Gerar prévia
        </Button>
        {preview && (
          <>
            <p className="rounded-md border bg-secondary p-3 text-sm">
              {preview.total} contatos; {preview.valid} válidos. Novos contatos serão{' '}
              {preview.mode === 'tenant'
                ? 'globais e compartilhados com a empresa'
                : 'individuais e visíveis somente para você'}
              . A mudança do modo pelo administrador exige uma nova prévia.
            </p>
            {preview.headers && (
              <details className="rounded-md border p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium">
                  Mapear colunas do CSV
                </summary>
                <div className="grid gap-3 sm:grid-cols-2">
                  {preview.headers.map((header, index) => (
                    <div key={index} className="space-y-2">
                      <Label htmlFor={'mapping-' + index}>{header}</Label>
                      <select
                        id={'mapping-' + index}
                        className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                        value={mapping[index] ?? ''}
                        disabled={busy}
                        onChange={(e) => setMapping({ ...mapping, [index]: e.target.value })}
                      >
                        <option value="">Ignorar coluna</option>
                        {OUTLOOK_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {fieldLabels[field]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <Button className="mt-3" disabled={busy} onClick={() => void remap()}>
                  Atualizar prévia
                </Button>
              </details>
            )}
            <ConfigurableTable
              listKey="contact-import-preview"
              mode="client"
              query={query}
              onQueryChange={setQuery}
              data={preview.rows.map((row) => ({
                id: String(row.row),
                row: row.row,
                name: (row.data as { name?: string }).name ?? '',
                company: (row.data as { company?: string }).company ?? '',
                job_title: (row.data as { job_title?: string }).job_title ?? '',
                emails: ((row.data as { emails?: { email: string }[] }).emails ?? [])
                  .map((value) => value.email)
                  .join(', '),
                phones: ((row.data as { phones?: { number: string }[] }).phones ?? [])
                  .map((value) => value.number)
                  .join(', '),
                errors:
                  [row.errors.join('; '), ...(row.warnings ?? [])].filter(Boolean).join('; ') ||
                  ({
                    new: 'Novo',
                    existing: 'Existente — aplicar política de duplicatas',
                    ambiguous: 'Correspondência ambígua — revisar',
                    file: 'Duplicado no arquivo — aplicar política de duplicatas',
                  }[row.duplicate ?? 'new'] ??
                    'Válido'),
              }))}
              columns={[
                { id: 'row', header: 'Linha', sortable: true },
                { id: 'name', header: 'Nome', hideable: false, sortable: true },
                { id: 'emails', header: 'E-mails' },
                { id: 'phones', header: 'Telefones' },
                { id: 'company', header: 'Empresa' },
                { id: 'job_title', header: 'Cargo', defaultVisible: false },
                { id: 'errors', header: 'Validação', cell: (r) => r.errors || 'Válido' },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Prévia das primeiras 100 linhas; todas as linhas são validadas pelo servidor. Linhas
              inválidas serão ignoradas e incluídas no relatório.
            </p>
            <Label htmlFor="contacts-duplicates">Contatos existentes nesta agenda</Label>
            <select
              id="contacts-duplicates"
              className="h-11 w-full rounded-md border bg-background px-3"
              value={duplicates}
              disabled={busy || !!result?.cursor}
              onChange={(e) => setDuplicates(e.target.value as 'skip' | 'update')}
            >
              <option value="skip">Ignorar existentes</option>
              <option value="update">Atualizar existentes com os dados do arquivo</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Atualizar preenche os dados do arquivo sem apagar campos vazios, canais e endereços já
              cadastrados; não altera o escopo nem os apelidos. Correspondências com mais de um
              contato exigem revisão manual.
            </p>
            {result && (
              <>
                <p role="status">
                  {result.cursor} de {result.total} processados
                </p>
                <progress className="w-full" value={result.cursor} max={result.total} />
                <ConfigurableTable
                  listKey="contact-import-report"
                  mode="client"
                  query={reportQuery}
                  onQueryChange={setReportQuery}
                  data={result.results.map((r) => ({
                    ...r,
                    status: resultLabels[r.status] ?? r.status,
                    id: String(r.row),
                  }))}
                  columns={[
                    { id: 'row', header: 'Linha', sortable: true },
                    { id: 'status', header: 'Resultado', hideable: false },
                    { id: 'message', header: 'Detalhe' },
                  ]}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result.results, null, 2)], {
                        type: 'application/json',
                      }),
                      url = URL.createObjectURL(blob),
                      a = document.createElement('a');
                    a.href = url;
                    a.download = 'relatorio-importacao-contatos.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Baixar relatório
                </Button>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {importing && (
            <Button
              variant="outline"
              onClick={() => {
                stop.current = true;
              }}
            >
              Interromper após este lote
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={!preview || busy || result?.cursor === preview.total}
            onClick={() => void run()}
          >
            {busy ? 'Importando…' : result?.cursor ? 'Continuar' : 'Confirmar importação'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
