import type { Article, SearchResult } from './types';

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function excerpt(article: Article, query: string) {
  const text = article.body.replace(/[#>*`|!-]/g, ' ').replace(/\s+/g, ' ').trim();
  const term = normalizeSearch(query);
  if (!term) return text.slice(0, 150) + (text.length > 150 ? '…' : '');
  const position = normalizeSearch(text).indexOf(term);
  const start = Math.max(0, position - 48);
  const value = text.slice(start, start + 180);
  return (start > 0 ? '…' : '') + value + (start + 180 < text.length ? '…' : '');
}

export function searchArticles(articles: Article[], query: string): SearchResult[] {
  const term = normalizeSearch(query);
  if (!term) return articles.slice(0, 8).map((article) => ({ article, score: 0, excerpt: excerpt(article, '') }));
  return articles
    .map((article) => {
      const title = normalizeSearch(article.title);
      const keywords = article.keywords.map(normalizeSearch).join(' ');
      const description = normalizeSearch(article.description);
      const body = normalizeSearch(article.body);
      let score = 0;
      if (title.includes(term)) score += title === term ? 100 : 70;
      if (keywords.includes(term)) score += 45;
      if (description.includes(term)) score += 25;
      if (body.includes(term)) score += 10;
      return { article, score, excerpt: excerpt(article, query) };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title, 'pt-BR'));
}
