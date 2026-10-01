import { useEffect, useState } from 'react';
import { useEditor, EditorContent, Node } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
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
    return { src: { default: null }, alt: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },
});
export function RichTextEditor({
  value,
  onChange,
  label = 'Mensagem',
  images = false,
}: {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  images?: boolean;
}) {
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null),
    [url, setUrl] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: 'Escreva sua mensagem…' }),
      EmailImage,
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
        {images && (
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
        )}
      </div>
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
