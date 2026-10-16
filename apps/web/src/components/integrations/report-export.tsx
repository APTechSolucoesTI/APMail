import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
export function ReportExport({
  path,
  transcript = false,
  label = 'Exportar',
}: {
  path: string;
  transcript?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async (format: string) => {
    // Open the print window synchronously, while the click still has browser activation.
    const printWindow = format === 'html' ? window.open('about:blank', '_blank') : null;
    setBusy(true);
    try {
      const response = await fetch(
        '/api' + path + (path.includes('?') ? '&' : '?') + 'format=' + format,
        { credentials: 'same-origin' },
      );
      if (!response.ok) {
        const error: unknown = await response.json();
        throw new Error(
          typeof error === 'object' && error && 'error' in error
            ? (error as { error: { message: string } }).error.message
            : 'Não foi possível gerar o relatório.',
        );
      }
      const blob = await response.blob();
      if (format === 'html') {
        if (!printWindow)
          throw new Error('Permita a abertura da janela para imprimir este relatório.');
        // The API escapes all report content and returns a script-free print document.
        printWindow.document.write(await blob.text());
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      } else {
        const url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download =
          response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
          'apmail-relatorio.' + format;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      printWindow?.close();
      toast.error(error instanceof Error ? error.message : 'Não foi possível gerar o relatório.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          <Download />
          {busy ? 'Preparando…' : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {['pdf', 'csv', ...(transcript ? ['txt', 'vtt'] : [])].map((format) => (
          <DropdownMenuItem key={format} onSelect={() => void download(format)}>
            Baixar {format.toUpperCase()}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => void download('html')}>
          <Printer />
          Imprimir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
