import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const contentRoot = join(project, 'src', 'content');
const dist = join(project, 'dist');
const origin = 'https://ajuda.apmail.com.br';
const allFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.md')) allFiles.push(path);
  }
}
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function parseFrontmatter(source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  const metadata = {};
  if (!match) return { metadata, body: source };
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) metadata[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { metadata, body: source.slice(match[0].length) };
}
function staticArticleBody(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;
  const inline = (value) => escape(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  const flushParagraph = () => { if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
  const flushList = () => { if (list) { const tag = list; html.push(`<${tag}>${listItems.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`); list = null; listItems = []; } };
  let listItems = [];
  for (const line of lines) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; const text = escape(heading[2]); const id = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'); html.push(`<h${level} id="${id}">${text}</h${level}>`); continue; }
    if (unordered || ordered) { flushParagraph(); const type = unordered ? 'ul' : 'ol'; if (list !== type) flushList(); list = type; listItems.push((unordered ?? ordered)[1]); continue; }
    if (/^:::(tip|warning|info)/.test(line) || line.trim() === ':::') continue;
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  return html.join('\n');
}
const template = await readFile(join(dist, 'index.html'), 'utf8');
await walk(contentRoot);
const pages = [];
for (const file of allFiles) {
  const source = await readFile(file, 'utf8');
  const { metadata, body } = parseFrontmatter(source);
  const slug = relative(contentRoot, file).replaceAll('\\', '/').replace(/\.md$/, '');
  const [category, articleSlug] = slug.split('/');
  const url = `${origin}/docs/${category}/${articleSlug}/`;
  const title = `${metadata.title ?? articleSlug} | Ajuda APMail`;
  const description = metadata.description ?? 'Documentação do APMail.';
  const shell = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escape(description)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${url}" />`)
    .replace('</head>', `<meta property="og:type" content="article" />\n    <meta property="og:title" content="${escape(metadata.title ?? articleSlug)}" />\n    <meta property="og:description" content="${escape(description)}" />\n    <meta property="og:url" content="${url}" />\n    <meta property="og:image" content="${origin}/og-cover.svg" />\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><main class="static-content"><article><nav><a href="/">Central de Ajuda APMail</a> / ${escape(category)}</nav><p class="static-audience">${escape(metadata.audience ?? 'Todos os usuários')} · ${escape(metadata.readingTime ?? '4')} min de leitura</p><h1>${escape(metadata.title ?? articleSlug)}</h1><p class="static-description">${escape(description)}</p>${staticArticleBody(body)}</article></main></div>`);
  const target = join(dist, 'docs', category, articleSlug, 'index.html');
  await mkdir(join(dist, 'docs', category, articleSlug), { recursive: true });
  await writeFile(target, shell);
  pages.push(url);
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[`${origin}/`, ...pages].map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(dist, 'sitemap.xml'), sitemap);
await writeFile(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`Generated ${pages.length} static article pages and sitemap.`);
