import { useEffect, useState } from 'react';
import { COMPOSITION_FONTS, COMPOSITION_SIZES, type CompositionFormat } from '@apmail/shared';
import { createPortal } from 'react-dom';
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
  IndentIncrease,
  IndentDecrease,
  ChevronDown,
  Ellipsis,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CompositionDefaults, setCompositionFormat } from '@/lib/composition-defaults';
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
      signatureImageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-apmail-signature-image'),
        renderHTML: (attributes) =>
          attributes.signatureImageId
            ? { 'data-apmail-signature-image': attributes.signatureImageId }
            : {},
      },
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
      dom.src = node.attrs.signatureImageId
        ? `/api/signatures/images/${node.attrs.signatureImageId}`
        : node.attrs.uploadId
          ? `/api/uploads/${node.attrs.uploadId}/image`
          : node.attrs.src;
      dom.alt = node.attrs.alt ?? '';
      if (node.attrs.width) dom.width = Number(node.attrs.width);
      if (node.attrs.height) dom.height = Number(node.attrs.height);
      return { dom };
    };
  },
});
const EmailSignature = Node.create({
  name: 'emailSignature',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      signatureId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-apmail-signature'),
        renderHTML: (attributes) => ({ 'data-apmail-signature': attributes.signatureId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-apmail-signature]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes, 0];
  },
});
export function RichTextEditor({
  value,
  onChange,
  label = 'Mensagem',
  images = false,
  onImageUpload,
  toolbarContainer,
  ribbon = false,
  compact = false,
  defaultFormat,
}: {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  images?: boolean;
  onImageUpload?: (file: File) => Promise<{ src: string; uploadId: string }>;
  toolbarContainer?: HTMLElement | null;
  ribbon?: boolean;
  compact?: boolean;
  defaultFormat?: CompositionFormat;
}) {
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null),
    [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState('Mensagem');
  const [expanded, setExpanded] = useState(false);
  const ParagraphLayout = Node.create({
    name: 'paragraphLayout',
    addGlobalAttributes() {
      return [
        {
          types: ['paragraph', 'heading'],
          attributes: {
            indent: {
              default: 0,
              parseHTML: (element) => parseInt(element.style.marginLeft || '0') || 0,
              renderHTML: (attrs) =>
                attrs.indent ? { style: `margin-left:${attrs.indent}px` } : {},
            },
            lineHeight: {
              default: null,
              parseHTML: (element) => element.style.lineHeight || null,
              renderHTML: (attrs) =>
                attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {},
            },
          },
        },
      ];
    },
  });
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: 'Escreva sua mensagem…' }),
      EmailImage,
      EmailSignature,
      ParagraphLayout,
      TextStyleKit,
      CompositionDefaults,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: ribbon
          ? 'min-h-64 p-5 text-sm focus:outline-none sm:min-h-80'
          : 'min-h-40 p-3 text-sm focus:outline-none',
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
  useEffect(() => {
    if (editor) setCompositionFormat(editor,defaultFormat);
  }, [editor, defaultFormat]);
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
      run: () =>
        editor
          .chain()
          .focus()
          .unsetAllMarks()
          .clearNodes()
          .resetAttributes('paragraph', ['textAlign', 'indent', 'lineHeight'])
          .run(),
    },
  ];
  const toolbar = (
    <div className={cn('shrink-0 bg-card', ribbon && 'border-b')}>
      {ribbon && (
        <div
          role="tablist"
          aria-label="Ferramentas da mensagem"
          className="flex gap-4 border-b px-4"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            ];
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault();
            tabs[next]?.focus();
            tabs[next]?.click();
          }}
        >
          {['Mensagem', 'Inserir', 'Formatar texto'].map((name) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === name}
              tabIndex={tab === name ? 0 : -1}
              key={name}
              onClick={() => setTab(name)}
              className={cn(
                'min-h-10 border-b-2 px-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring',
                tab === name
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Formatação"
        className={cn('flex flex-wrap items-center gap-1 p-2', !ribbon && 'border-b')}
      >
        {(!compact || expanded) && (!ribbon || tab !== 'Inserir') && (
          <>
            <label className="flex flex-col text-xs gap-1 p-1">
              <span className={ribbon ? 'sr-only' : undefined}>Fonte</span>
              <select
                aria-label="Fonte"
                className="h-8 max-w-32 rounded-md border bg-card px-2 text-xs"
                value={editor.getAttributes('textStyle').fontFamily || 'Arial, sans-serif'}
                onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
              >
                {COMPOSITION_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font.split(',')[0]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1 p-1">
              <span className={ribbon ? 'sr-only' : undefined}>Tamanho</span>
              <select
                aria-label="Tamanho da fonte"
                className="h-8 rounded-md border bg-card px-2 text-xs"
                value={editor.getAttributes('textStyle').fontSize || '14px'}
                onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
              >
                {COMPOSITION_SIZES.map((size) => (
                  <option key={size} value={`${size}px`}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1 p-1">
              <span className={ribbon ? 'sr-only' : undefined}>Cor do texto</span>
              <input
                type="color"
                aria-label="Cor do texto"
                className="h-8 w-9 rounded border"
                value={editor.getAttributes('textStyle').color || '#111827'}
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              />
            </label>
            <label className="flex flex-col text-xs gap-1 p-1">
              <span className={ribbon ? 'sr-only' : undefined}>Cor de fundo</span>
              <input
                type="color"
                aria-label="Cor de fundo do texto"
                defaultValue="#ffff00"
                className="h-8 w-9 rounded border"
                onChange={(e) => editor.chain().focus().setBackgroundColor(e.target.value).run()}
              />
            </label>
          </>
        )}
        {buttons
          .filter(
            (b) =>
              !compact ||
              expanded ||
              [
                'Negrito',
                'Itálico',
                'Sublinhado',
                'Lista com marcadores',
                'Lista numerada',
                'Inserir link',
              ].includes(b.label),
          )
          .filter(
            (b) =>
              !ribbon ||
              (tab === 'Inserir'
                ? [
                    'Inserir link',
                    'Inserir tabela 3 por 3',
                    'Linha horizontal',
                    'Citação',
                  ].includes(b.label)
                : tab === 'Mensagem'
                  ? [
                      'Negrito',
                      'Itálico',
                      'Sublinhado',
                      'Lista com marcadores',
                      'Lista numerada',
                      'Desfazer',
                      'Refazer',
                    ].includes(b.label)
                  : !['Inserir link', 'Inserir tabela 3 por 3', 'Linha horizontal'].includes(
                      b.label,
                    )),
          )
          .map((b) => (
            <Button
              key={b.label}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={b.label}
              title={b.label}
              disabled={
                b.label === 'Desfazer'
                  ? !editor.can().undo()
                  : b.label === 'Refazer'
                    ? !editor.can().redo()
                    : false
              }
              aria-pressed={!!b.active && editor.isActive(b.active)}
              onClick={b.run}
            >
              <b.icon />
            </Button>
          ))}
        {(!compact || expanded) && (!ribbon || tab === 'Inserir') && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={images ? 'Anexar imagem' : 'Inserir imagem'}
            onClick={() => {
              setUrl('');
              setDialog('image');
            }}
          >
            <Image />
          </Button>
        )}
        {(!compact || expanded) && (!ribbon || tab === 'Formatar texto') && (
          <>
            {[false, true].map((increase) => (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                key={String(increase)}
                aria-label={increase ? 'Aumentar recuo' : 'Diminuir recuo'}
                title={increase ? 'Aumentar recuo' : 'Diminuir recuo'}
                onClick={() => {
                  if (editor.isActive('listItem')) {
                    if (increase) editor.chain().focus().sinkListItem('listItem').run();
                    else editor.chain().focus().liftListItem('listItem').run();
                  } else {
                    const type = editor.isActive('heading') ? 'heading' : 'paragraph';
                    editor
                      .chain()
                      .focus()
                      .updateAttributes(type, {
                        indent: Math.max(
                          0,
                          Math.min(
                            320,
                            Number(editor.getAttributes(type).indent || 0) + (increase ? 24 : -24),
                          ),
                        ),
                      })
                      .run();
                  }
                }}
              >
                {increase ? <IndentIncrease /> : <IndentDecrease />}
              </Button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  Espaçamento <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {['1', '1.15', '1.5', '2'].map((lineHeight) => (
                  <DropdownMenuItem
                    key={lineHeight}
                    onSelect={() =>
                      editor
                        .chain()
                        .focus()
                        .updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', {
                          lineHeight,
                        })
                        .run()
                    }
                  >
                    {lineHeight}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {compact && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={expanded ? 'Menos formatação' : 'Mais formatação'}
            aria-expanded={expanded}
            title={expanded ? 'Menos formatação' : 'Mais formatação'}
            onClick={() => setExpanded(!expanded)}
          >
            <Ellipsis />
          </Button>
        )}
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
    </div>
  );
  return (
    <div
      className={cn(
        'rich-text-editor bg-card focus-within:ring-2 focus-within:ring-ring',
        ribbon ? 'min-h-64 flex-1' : 'rounded-md border border-input',
      )}
    >
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
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
            <DialogDescription>
              {dialog === 'image' && images
                ? 'Anexe a imagem. Ela será incorporada automaticamente ao e-mail enviado.'
                : 'Informe um endereço HTTPS.'}
            </DialogDescription>
          </DialogHeader>
          {!(dialog === 'image' && images) && (
            <>
              <Label htmlFor="editor-url">Endereço</Label>
              <Input
                id="editor-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </>
          )}
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
                        attrs: {
                          src: `cid:signature-${data.id}@apmail.local`,
                          signatureImageId: data.id,
                          alt: file.name,
                          width: Math.min(600, data.width),
                        },
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
          {!(dialog === 'image' && images) && (
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
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
