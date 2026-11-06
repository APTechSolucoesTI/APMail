import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type {
  SpellcheckRequest,
  SpellcheckResponse,
  SpellingRange,
  TextBlock,
} from '@/lib/spellcheck/protocol';

const spellingKey = new PluginKey<DecorationSet>('composerSpelling');
const markedWord = '[data-apmail-spelling]';

function reviewableBlocks(doc: ProseMirrorNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'emailSignature' || node.type.spec.code) return false;
    if (!node.isTextblock) return;

    let text = '';
    node.forEach((child) => {
      const reviewable = child.isText && !child.marks.some((mark) => mark.type.name === 'link');
      text += reviewable ? child.text! : ' '.repeat(child.nodeSize);
    });
    if (text.trim()) blocks.push({ from: pos + 1, text });
    return false;
  });
  return blocks;
}

function rangeAt(view: EditorView, pos: number): SpellingRange | undefined {
  const match = spellingKey.getState(view.state)?.find(pos, pos)[0];
  if (!match) return;
  const word = match.spec.word as string;
  if (view.state.doc.textBetween(match.from, match.to) === word) {
    return { from: match.from, to: match.to, word };
  }
}

type Review = { id: number; range: SpellingRange; items?: string[] };

export function ComposerSpellcheck({ editor }: { editor: Editor }) {
  const [review, setReview] = useState<Review | null>(null);
  const anchor = useRef<Element | null>(null);
  const suggestions = useRef<HTMLDivElement>(null);
  const ignored = useRef(new Set<string>());

  useEffect(() => {
    let worker: Worker | undefined;
    let unavailable = false;
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    let pending: { id: number; doc: ProseMirrorNode } | undefined;

    function updateMarks(marks: DecorationSet) {
      editor.view.dispatch(editor.state.tr.setMeta(spellingKey, marks));
    }

    function showError() {
      if (unavailable || editor.isDestroyed) return;
      unavailable = true;
      setReview(null);
      updateMarks(DecorationSet.empty);
      toast.error('Não foi possível carregar o corretor do APMail.', {
        description: 'Desative e reative a correção ortográfica para tentar novamente.',
      });
    }

    function receive({ data }: MessageEvent<SpellcheckResponse>) {
      if (data.type === 'unavailable') {
        showError();
      } else if (data.type === 'suggestions') {
        setReview((current) =>
          current?.id === data.id ? { ...current, items: data.items } : current,
        );
      } else if (pending?.id === data.id && pending.doc === editor.state.doc) {
        const marks = data.ranges
          .filter(({ word }) => !ignored.current.has(word))
          .map(({ from, to, word }) =>
            Decoration.inline(
              from,
              to,
              {
                class: 'underline decoration-wavy decoration-destructive underline-offset-2',
                'data-apmail-spelling': 'true',
              },
              { word },
            ),
          );
        updateMarks(DecorationSet.create(editor.state.doc, marks));
      }
    }

    function send(request: SpellcheckRequest) {
      if (unavailable) return;
      try {
        if (!worker) {
          worker = new Worker(
            new URL('../../lib/spellcheck/spellcheck.worker.ts', import.meta.url),
            {
              type: 'module',
            },
          );
          worker.onmessage = receive;
          worker.onerror = showError;
        }
        worker.postMessage(request);
      } catch {
        showError();
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editor.isDestroyed || editor.view.composing || unavailable) return;
        const doc = editor.state.doc;
        const blocks = reviewableBlocks(doc);
        if (!blocks.length) {
          updateMarks(DecorationSet.empty);
          return;
        }
        pending = { id: ++id, doc };
        send({ type: 'check', id, blocks });
      }, 350);
    }

    function open(view: EditorView, pos: number, element?: Element) {
      const range = rangeAt(view, pos);
      if (!range) return false;
      if (!element) {
        const { node } = view.domAtPos(range.from + 1);
        const target = node instanceof Element ? node : node.parentElement;
        element = target?.closest(markedWord) ?? undefined;
      }
      if (!element) return false;
      anchor.current = element;
      setReview({ id: ++id, range });
      send({ type: 'suggest', id, word: range.word });
      return true;
    }

    editor.registerPlugin(
      new Plugin({
        key: spellingKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, marks) =>
            (tr.getMeta(spellingKey) as DecorationSet | undefined) ?? marks.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => spellingKey.getState(state),
          handleKeyDown: (view, event) =>
            event.shiftKey && event.key === 'F10' && open(view, view.state.selection.head),
          handleDOMEvents: {
            click: (view, event) => {
              const element = event.target instanceof Element && event.target.closest(markedWord);
              if (element && event.detail < 2 && view.state.selection.empty) {
                open(view, view.posAtDOM(element, 0), element);
              }
              return false;
            },
            compositionend: () => {
              schedule();
              return false;
            },
          },
        },
      }),
    );

    function onTransaction({ transaction }: { transaction: Transaction }) {
      if (!transaction.docChanged) return;
      setReview(null);
      schedule();
    }
    editor.on('transaction', onTransaction);
    schedule();
    return () => {
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      editor.off('transaction', onTransaction);
      if (!editor.isDestroyed) editor.unregisterPlugin(spellingKey);
    };
  }, [editor]);

  function replace(range: SpellingRange, suggestion: string) {
    const { doc, schema, tr } = editor.state;
    if (doc.textBetween(range.from, range.to) !== range.word) return;
    const marks = doc.resolve(range.from).nodeAfter?.marks;
    tr.replaceWith(range.from, range.to, schema.text(suggestion, marks));
    tr.setSelection(TextSelection.create(tr.doc, range.from + suggestion.length));
    editor.view.dispatch(tr);
    setReview(null);
    editor.commands.focus();
  }

  function ignore(word: string) {
    ignored.current.add(word);
    const marks = spellingKey.getState(editor.state);
    if (marks) {
      const remaining = marks.remove(
        marks.find(undefined, undefined, (spec) => spec.word === word),
      );
      editor.view.dispatch(editor.state.tr.setMeta(spellingKey, remaining));
    }
    setReview(null);
    editor.commands.focus();
  }

  return (
    <Popover open={!!review} onOpenChange={(open) => !open && setReview(null)}>
      <PopoverAnchor virtualRef={anchor} />
      {review && (
        <PopoverContent
          align="start"
          aria-label="Sugestões ortográficas"
          className="w-56 max-w-[calc(100vw-2rem)] p-2"
          ref={suggestions}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            suggestions.current?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => editor.view.focus()}
        >
          <p className="break-words px-2 py-1 text-xs font-medium text-muted-foreground">
            Sugestões para “{review.range.word}”
          </p>
          <div className="grid">
            {review.items?.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => replace(review.range, suggestion)}
              >
                {suggestion}
              </Button>
            ))}
            {!review.items?.length && (
              <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
                {review.items ? 'Nenhuma sugestão encontrada.' : 'Buscando sugestões…'}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => ignore(review.range.word)}
            >
              Ignorar nesta revisão
            </Button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
