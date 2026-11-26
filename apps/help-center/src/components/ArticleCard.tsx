import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { Article } from '../lib/types';
import { getArticleUrl } from '../content';

export function ArticleCard({ article, icon: Icon }: { article: Article; icon?: LucideIcon }) {
  return <a className="article-card" href={getArticleUrl(article)}>{Icon && <span className="article-card-icon"><Icon size={19} /></span>}<span><strong>{article.title}</strong><span>{article.description}</span></span><ArrowRight size={16} /></a>;
}
