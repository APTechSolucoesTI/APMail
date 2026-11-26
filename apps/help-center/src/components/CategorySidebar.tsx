import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { categories, getArticle, getArticleUrl } from '../content';
import type { Article } from '../lib/types';

export function CategorySidebar({ article, open, onClose }: { article?: Article; open?: boolean; onClose?: () => void }) {
  const [expanded, setExpanded] = useState(() => article?.category ?? 'primeiros-passos');
  return (
    <aside className={`category-sidebar ${open ? 'is-open' : ''}`} aria-label="Artigos da Central de Ajuda">
      <div className="sidebar-heading"><span>Explore por assunto</span>{onClose && <button className="icon-button sidebar-close" aria-label="Fechar menu" onClick={onClose}><X size={18} /></button>}</div>
      <nav>
        {categories.map((category) => {
          const active = article?.category === category.slug;
          const isExpanded = active || expanded === category.slug;
          return <section className="category-group" key={category.slug}>
            <button className={`category-toggle ${active ? 'active' : ''}`} type="button" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? '' : category.slug)}>
              <span><span className="category-dot" />{category.title}</span><ChevronDown size={15} className={isExpanded ? 'rotate' : ''} />
            </button>
            {isExpanded && <div className="category-links">
              {category.articleSlugs.map((slug) => {
                const item = getArticle(category.slug, slug);
                const title = item?.title ?? slug.replaceAll('-', ' ');
                return <a className={article?.slug === slug && article?.category === category.slug ? 'current' : ''} href={getArticleUrl({ category: category.slug, slug })} key={slug}>{title}</a>;
              })}
            </div>}
          </section>;
        })}
      </nav>
    </aside>
  );
}
