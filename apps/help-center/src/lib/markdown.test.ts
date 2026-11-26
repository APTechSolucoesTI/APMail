import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseFrontmatter, slugifyHeading } from './markdown';

describe('parseMarkdown', () => {
  it('extracts headings, lists, code and callouts', () => {
    const document = parseMarkdown(`## Uma seção\n\nTexto **importante**.\n\n- Um\n- Dois\n\n:::tip Dica\nUse o menu.\n:::\n\n\`\`\`bash\npnpm test\n\`\`\``);
    expect(document.headings).toEqual([{ id: 'uma-secao', text: 'Uma seção', level: 2 }]);
    expect(document.blocks.map((block) => block.type)).toEqual([
      'heading', 'paragraph', 'unordered-list', 'callout', 'code',
    ]);
  });

  it('does not preserve executable HTML as markup', () => {
    const document = parseMarkdown('<script>alert(1)</script>\n\n<img src="x">');
    expect(document.blocks[0]).toMatchObject({ type: 'paragraph' });
    expect((document.blocks[0] as { text: string }).text).toContain('&lt;script&gt;');
    expect((document.blocks[0] as { text: string }).text).not.toContain('<script>');
  });
});

describe('frontmatter helpers', () => {
  it('reads metadata and leaves the body', () => {
    const result = parseFrontmatter('---\ntitle: Título\nkeywords: um, dois\n---\n\nCorpo');
    expect(result.values.title).toBe('Título');
    expect(result.body).toContain('Corpo');
  });

  it('creates stable heading ids with accents removed', () => {
    expect(slugifyHeading('Ação e visão geral')).toBe('acao-e-visao-geral');
  });
});
