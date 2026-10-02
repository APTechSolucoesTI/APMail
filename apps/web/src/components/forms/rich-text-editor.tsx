import { useEffect, useState } from 'react';
import { useEditor, EditorContent, Node } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { toast } from 'sonner';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link,
  Quote,
  RemoveFormatting,
  Image,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Undo2,
  Redo2,
  Minus,
  Table,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
const EmailImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
      uploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-apmail-upload'),
        renderHTML: (attributes) =>
          attributes.uploadId ? { 'data-apmail-upload': attributes.uploadId } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      dom.src = node.attrs.uploadId ? `/api/uploads/${node.attrs.uploadId}/image` : node.attrs.src;
      dom.alt = node.attrs.alt ?? '';
      if (node.attrs.width) dom.width = Number(node.attrs.width);
      if (node.attrs.height) dom.height = Number(node.attrs.height);
      return { dom };
    };
  },
});
export function RichTextEditor({
  value,
  onChange,
  label = 'Mensagem',
  images = false,
  onImageUpload,
}: {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  images?: boolean;
  onImageUpload?: (file: File) => Promise<{ src: string; uploadId: string }>;
}) {
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null),
    [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: 'Escreva sua mensagem…' }),
      EmailImage,
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'min-h-40 p-3 text-sm focus:outline-none',
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setDialog('link');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML())
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  if (!editor)
    return (
      <div role="status" className="min-h-40 rounded-md border p-3">
        Carregando editor…
      </div>
    );
  const buttons = [
    { label: 'Desfazer', icon: Undo2, active: '', run: () => editor.chain().focus().undo().run() },
    { label: 'Refazer', icon: Redo2, active: '', run: () => editor.chain().focus().redo().run() },
    {
      label: 'Tachado',
      icon: Strikethrough,
      active: 'strike',
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    ...(['left', 'center', 'right', 'justify'] as const).map((align, i) => ({
      label: ['Alinhar à esquerda', 'Centralizar', 'Alinhar à direita', 'Justificar'][i]!,
      icon: [AlignLeft, AlignCenter, AlignRight, AlignJustify][i]!,
      active: '',
      run: () => editor.chain().focus().setTextAlign(align).run(),
    })),
    {
      label: 'Linha horizontal',
      icon: Minus,
      active: '',
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: 'Inserir tabela 3 por 3',
      icon: Table,
      active: 'table',
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      label: 'Negrito',
      icon: Bold,
      active: 'bold',
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Itálico',
      icon: Italic,
      active: 'italic',
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Sublinhado',
      icon: Underline,
      active: 'underline',
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: 'Lista com marcadores',
      icon: List,
      active: 'bulletList',
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Lista numerada',
      icon: ListOrdered,
      active: 'orderedList',
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Inserir link',
      icon: Link,
      active: 'link',
      run: () => {
        setUrl(editor.getAttributes('link').href ?? '');
        setDialog('link');
      },
    },
    {
      label: 'Citação',
      icon: Quote,
      active: 'blockquote',
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Limpar formatação',
      icon: RemoveFormatting,
      active: '',
      run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  ];
  return (
    <div className="rich-text-editor rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
      <div role="toolbar" aria-label="Formatação" className="flex flex-wrap gap-1 border-b p-1">
        <label className="flex flex-col text-xs gap-1 p-1">
          Fonte
          <select
            aria-label="Fonte"
            className="h-9 rounded-md border bg-card px-2 text-sm"
            defaultValue="Arial, sans-serif"
            onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          >
            {[
              'Arial, sans-serif',
              'Verdana, sans-serif',
              'Tahoma, sans-serif',
              'Georgia, serif',
              'Times New Roman, serif',
              'Courier New, monospace',
            ].map((font) => (
              <option key={font} value={font}>
                {font.split(',')[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs gap-1 p-1">
          Tamanho
          <select
            aria-label="Tamanho da fonte"
            className="h-9 rounded-md border bg-card px-2 text-sm"
            defaultValue="14px"
            onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
          >
            {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => (
              <option key={size} value={`${size}px`}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs gap-1 p-1">
          Cor do texto
          <input
            type="color"
            aria-label="Cor do texto"
            className="h-9 w-12 rounded border"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
        <label className="flex flex-col text-xs gap-1 p-1">
          Cor de fundo
          <input
            type="color"
            aria-label="Cor de fundo do texto"
            defaultValue="#ffff00"
            className="h-9 w-12 rounded border"
            onChange={(e) => editor.chain().focus().setBackgroundColor(e.target.value).run()}
          />
        </label>
        {buttons.map((b) => (
          <Button
            key={b.label}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={b.label}
            title={b.label}
            aria-pressed={!!b.active && editor.isActive(b.active)}
            onClick={b.run}
          >
            <b.icon />
          </Button>
        ))}
        {
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Imagem por URL"
            onClick={() => {
              setUrl('');
              setDialog('image');
            }}
          >
            <Image />
          </Button>
        }
      </div>
      {editor.isActive('table') && (
        <div className="flex flex-wrap gap-1 border-b p-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Adicionar linha
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Adicionar coluna
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            Remover linha
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            Remover coluna
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Remover tabela
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'image' ? 'Inserir imagem' : 'Inserir link'}</DialogTitle>
            <DialogDescription>Informe um endereço HTTPS.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="editor-url">Endereço</Label>
          <Input id="editor-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          {dialog === 'image' && (images || onImageUpload) && (
            <div className="space-y-2">
              <Label htmlFor="signature-upload">Anexar imagem (JPEG, PNG ou WebP, até 5 MB)</Label>
              <Input
                id="signature-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    if (onImageUpload) {
                      const data = await onImageUpload(file);
                      editor
                        .chain()
                        .focus()
                        .insertContent({
                          type: 'image',
                          attrs: { ...data, alt: file.name, width: 400 },
                        })
                        .run();
                      setDialog(null);
                      return;
                    }
                    const body = new FormData();
                    body.append('file', file);
                    const response = await fetch('/api/signatures/images', {
                      method: 'POST',
                      body,
                      credentials: 'same-origin',
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message ?? 'Falha no upload.');
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: 'image',
                        attrs: { src: data.url, alt: file.name, width: Math.min(600, data.width) },
                      })
                      .run();
                    setDialog(null);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Falha no upload.');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
              {uploading && (
                <p role="status" className="text-sm">
                  Processando imagem…
                </p>
              )}
            </div>
          )}
          <Button
            disabled={!/^https:\/\/[^\s]+$/i.test(url)}
            onClick={() => {
              if (dialog === 'image')
                editor
                  .chain()
                  .focus()
                  .insertContent({ type: 'image', attrs: { src: url, alt: '' } })
                  .run();
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
              setDialog(null);
            }}
          >
            Inserir
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
