import { describe, expect, it } from 'vitest';
import { searchArticles } from './search';
import type { Article } from './types';

const articles: Article[] = [
  {
    slug: 'caixas', category: 'admin', title: 'Configurar caixas de e-mail', description: 'Conecte uma caixa.', audience: 'Administrador', readingTime: 4, updatedAt: '26 de novembro de 2026', keywords: ['IMAP', 'SMTP'], prerequisites: [], related: [], source: '', body: 'Configure a conexão IMAP e SMTP.', headings: [],
  },
  {
    slug: 'responder', category: 'email', title: 'Como responder', description: 'Responda uma conversa.', audience: 'Usuário', readingTime: 3, updatedAt: '26 de novembro de 2026', keywords: ['resposta'], prerequisites: [], related: [], source: '', body: 'Escreva sua resposta.', headings: [],
  },
];

describe('searchArticles', () => {
  it('matches accents and ranks title matches first', () => {
    const result = searchArticles(articles, 'CAIXAS');
    expect(result[0]?.article.slug).toBe('caixas');
  });

  it('returns a useful bounded list for an empty query', () => {
    expect(searchArticles(articles, '')).toHaveLength(2);
  });

  it('returns no results for an unknown term', () => {
    expect(searchArticles(articles, 'calendário')).toEqual([]);
  });
});
