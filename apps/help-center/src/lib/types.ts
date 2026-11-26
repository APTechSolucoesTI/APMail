export type Audience = 'Administrador' | 'Usuário' | 'Todos os usuários';

export type ArticleMeta = {
  slug: string;
  category: string;
  title: string;
  description: string;
  audience: Audience;
  readingTime: number;
  updatedAt: string;
  keywords: string[];
  prerequisites: string[];
  related: string[];
};

export type Heading = { id: string; text: string; level: 2 | 3 };

export type Article = ArticleMeta & {
  source: string;
  headings: Heading[];
  body: string;
};

export type Category = {
  slug: string;
  title: string;
  description: string;
  icon: string;
  audience: Audience | 'Todos';
  articleSlugs: string[];
};

export type SearchResult = {
  article: Article;
  score: number;
  excerpt: string;
};
