import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { getArticleUrl } from '../content';
import { searchArticles } from '../lib/search';
import type { Article } from '../lib/types';

export function SearchDialog({ articles, open, onClose }: { articles: Article[]; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const results = searchArticles(articles, query);
  useEffect(() => { if (open) { setQuery(''); requestAnimationFrame(() => input.current?.focus()); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Pesquisar na documentação">
      <div className="search-dialog-input"><Search size={20} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquise uma dúvida, tela ou tarefa..." /><button className="icon-button" onClick={onClose} aria-label="Fechar pesquisa"><X size={18} /></button></div>
      <div className="search-dialog-body">
        {!query && <p className="search-hint">Digite o nome de uma funcionalidade, botão ou tarefa.</p>}
        {query && !results.length && <div className="empty-search"><strong>Nenhum artigo encontrado</strong><span>Tente outra palavra, como “caixa”, “contato” ou “permissão”.</span></div>}
        {results.map(({ article, excerpt }) => <a className="search-result" href={getArticleUrl(article)} key={`${article.category}/${article.slug}`}>
          <span className="result-category">{article.category.replaceAll('-', ' ')}</span><strong>{article.title}</strong><span>{excerpt}</span><ArrowRight size={16} />
        </a>)}
      </div>
      <div className="search-dialog-footer"><span>Use <kbd>↑</kbd> <kbd>↓</kbd> para navegar</span><span><kbd>Esc</kbd> fechar</span></div>
    </section>
  </div>;
}
