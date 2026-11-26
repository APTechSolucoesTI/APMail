import type { Article, Category } from '../lib/types';
import { parseFrontmatter, parseList, parseMarkdown } from '../lib/markdown';

const files = import.meta.glob('./**/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

export const categories: Category[] = [
  { slug: 'primeiros-passos', title: 'Primeiros passos', description: 'Comece com segurança e siga a ordem certa.', icon: 'Compass', audience: 'Todos', articleSlugs: [] },
  { slug: 'email', title: 'E-mails e conversas', description: 'Leia, responda, organize e envie mensagens.', icon: 'Mail', audience: 'Todos', articleSlugs: [] },
  { slug: 'atendimento', title: 'Atendimento e colaboração', description: 'Trabalhe em equipe sem perder o contexto.', icon: 'UsersRound', audience: 'Todos', articleSlugs: [] },
  { slug: 'contatos', title: 'Contatos', description: 'Mantenha os endereços da equipe organizados.', icon: 'ContactRound', audience: 'Todos', articleSlugs: [] },
  { slug: 'produtividade', title: 'Produtividade', description: 'Use regras, assinaturas, calendário e preferências.', icon: 'Sparkles', audience: 'Todos', articleSlugs: [] },
  { slug: 'analise', title: 'Dashboard e relatórios', description: 'Entenda volume, prazos e produtividade.', icon: 'ChartNoAxesCombined', audience: 'Administrador', articleSlugs: [] },
  { slug: 'administracao', title: 'Administração', description: 'Configure empresa, caixas, equipe e acessos.', icon: 'Settings2', audience: 'Administrador', articleSlugs: [] },
  { slug: 'integracoes', title: 'Integrações', description: 'Conecte serviços e automações com segurança.', icon: 'Webhook', audience: 'Administrador', articleSlugs: [] },
  { slug: 'seguranca', title: 'Segurança e retenção', description: 'Proteja arquivos e recupere mensagens quando necessário.', icon: 'ShieldCheck', audience: 'Administrador', articleSlugs: [] },
  { slug: 'ajuda', title: 'Problemas comuns', description: 'Encontre respostas para situações do dia a dia.', icon: 'LifeBuoy', audience: 'Todos', articleSlugs: [] },
];

function categoryFor(slug: string) {
  return categories.find((category) => category.slug === slug);
}

export const articles: Article[] = Object.entries(files).map(([path, source]) => {
  const match = path.match(/^\.\/([^/]+)\/([^/]+)\.md$/);
  if (!match) throw new Error(`Caminho de artigo inválido: ${path}`);
  const category = match[1]!;
  const slug = match[2]!;
  const { values, body } = parseFrontmatter(source);
  const article: Article = {
    slug,
    category,
    title: values.title ?? slug,
    description: values.description ?? '',
    audience: (values.audience ?? 'Todos os usuários') as Article['audience'],
    readingTime: Number(values.readingTime ?? 4),
    updatedAt: values.updatedAt ?? '26 de novembro de 2026',
    keywords: parseList(values.keywords),
    prerequisites: parseList(values.prerequisites),
    related: parseList(values.related),
    source,
    body,
    headings: parseMarkdown(body).headings,
  };
  categoryFor(category)?.articleSlugs.push(slug);
  return article;
});

export function getArticle(category: string, slug: string) {
  return articles.find((article) => article.category === category && article.slug === slug);
}

export function getCategory(slug: string) {
  return categoryFor(slug);
}

export function getArticleUrl(article: Pick<Article, 'category' | 'slug'>) {
  return `/docs/${article.category}/${article.slug}/`;
}
