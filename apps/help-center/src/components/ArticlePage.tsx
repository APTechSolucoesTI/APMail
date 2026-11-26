import { ArrowLeft, ArrowRight, BookOpen, Clock3, UserRound } from 'lucide-react';
import { getArticle, getArticleUrl, getCategory, articles } from '../content';
import { parseMarkdown } from '../lib/markdown';
import type { Article } from '../lib/types';
import { Callout } from './Callout';
import { ImageLightbox } from './ImageLightbox';
import { TableOfContents } from './TableOfContents';

function inlineText(value: string) {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a href={link[2]} key={index}>{link[1]}</a>;
    return <span key={index}>{part}</span>;
  });
}

export function ArticlePage({ article }: { article: Article }) {
  const document = parseMarkdown(article.body);
  const category = getCategory(article.category);
  const position = articles.findIndex((item) => item.slug === article.slug && item.category === article.category);
  const previous = articles[position - 1];
  const next = articles[position + 1];
  const related = article.related.map((value) => { const [cat, slug] = value.split('/'); return getArticle(cat!, slug!); }).filter(Boolean) as Article[];
  return <>
    <div className="breadcrumbs"><a href="/">Ajuda</a><span>/</span><a href={`/docs/${article.category}/`}>{category?.title}</a><span>/</span><span>{article.title}</span></div>
    <div className="article-grid">
      <article className="article">
        <header className="article-header"><h1>{article.title}</h1><p className="article-description">{article.description}</p><div className="article-meta"><span className="audience"><UserRound size={14} />{article.audience}</span><span><Clock3 size={14} />{article.readingTime} min de leitura</span><span>Atualizado em {article.updatedAt}</span></div></header>
        {article.prerequisites.length > 0 && <div className="prerequisites"><strong>Antes de começar</strong><span>{article.prerequisites.join(' · ')}</span></div>}
        <div className="article-body">
          {document.blocks.map((block, index) => {
            if (block.type === 'heading') { const Tag = block.level === 2 ? 'h2' : 'h3'; return <Tag id={block.id} key={index}>{block.text}</Tag>; }
            if (block.type === 'paragraph') return <p key={index}>{inlineText(block.text)}</p>;
            if (block.type === 'unordered-list') return <ul key={index}>{block.items.map((item) => <li key={item}>{inlineText(item)}</li>)}</ul>;
            if (block.type === 'ordered-list') return <ol key={index}>{block.items.map((item) => <li key={item}>{inlineText(item)}</li>)}</ol>;
            if (block.type === 'quote') return <blockquote key={index}>{inlineText(block.text)}</blockquote>;
            if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
            if (block.type === 'image') return <ImageLightbox key={index} src={block.src} alt={block.alt} />;
            if (block.type === 'callout') return <Callout key={index} tone={block.tone} title={block.title}>{inlineText(block.text)}</Callout>;
            if (block.type === 'table') return <div className="article-table-wrap" key={index}><table><thead><tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineText(cell)}</td>)}</tr>)}</tbody></table></div>;
            return null;
          })}
        </div>
        {related.length > 0 && <section className="related"><div className="section-kicker"><BookOpen size={15} /> Continue aprendendo</div><h2>Artigos relacionados</h2><div className="related-grid">{related.map((item) => <a href={getArticleUrl(item)} key={item.slug}><strong>{item.title}</strong><span>{item.description}</span><ArrowRight size={15} /></a>)}</div></section>}
        <nav className="article-nav" aria-label="Artigos anterior e próximo">{previous ? <a href={getArticleUrl(previous)}><ArrowLeft size={16} /><span><small>Anterior</small><strong>{previous.title}</strong></span></a> : <span />}{next ? <a className="next" href={getArticleUrl(next)}><span><small>Próximo</small><strong>{next.title}</strong></span><ArrowRight size={16} /></a> : <span />}</nav>
      </article>
      <TableOfContents headings={article.headings} />
    </div>
  </>;
}
