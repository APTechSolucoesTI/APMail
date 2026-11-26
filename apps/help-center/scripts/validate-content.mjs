import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/content/', import.meta.url));
const errors = [];
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.md')) files.push(path);
  }
}
await walk(root);
const slugs = new Set();
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const fileSlug = relative(root, file).replaceAll('\\', '/').replace(/\.md$/, '');
  if (!match) { errors.push(`${fileSlug}: bloco de metadados ausente`); continue; }
  const fields = new Map(match[1].split(/\r?\n/).map((line) => { const index = line.indexOf(':'); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ['', '']; }));
  for (const key of ['title', 'description', 'audience', 'readingTime', 'updatedAt', 'keywords', 'related']) if (!fields.get(key)) errors.push(`${fileSlug}: metadado ${key} obrigatório`);
  if (!['Administrador', 'Usuário', 'Todos os usuários'].includes(fields.get('audience'))) errors.push(`${fileSlug}: público inválido`);
  const articleSlug = fileSlug.split('/').at(-1);
  if (slugs.has(fileSlug)) errors.push(`${fileSlug}: slug duplicado`);
  slugs.add(fileSlug);
  if (articleSlug !== fileSlug.split('/').at(-1)) errors.push(`${fileSlug}: slug inválido`);
  for (const relation of (fields.get('related') ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(relation)) errors.push(`${fileSlug}: relação inválida: ${relation}`);
  }
  for (const image of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!image[1].startsWith('/images/')) errors.push(`${fileSlug}: imagem deve estar em /images/: ${image[1]}`);
  }
  if (/\b(aptechinfo\.com\.br|AP@Tech#2022|82be82c6-f7b1-4ad4-bee5-05729e75ac94|192\.168\.3\.106)\b/i.test(source)) errors.push(`${fileSlug}: possível dado interno ou credencial`);
  const title = fields.get('title');
  if (!title || title.length < 5) errors.push(`${fileSlug}: título muito curto`);
}
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const fileSlug = relative(root, file).replaceAll('\\', '/').replace(/\.md$/, '');
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const relatedLine = match?.[1].split(/\r?\n/).find((line) => line.startsWith('related:'))?.slice('related:'.length) ?? '';
  for (const relation of relatedLine.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!slugs.has(relation)) errors.push(`${fileSlug}: artigo relacionado não encontrado: ${relation}`);
  }
}
if (errors.length) {
  console.error('Validação de artigos encontrou problemas:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else console.log(`${files.length} artigos validados; sem referências quebradas ou dados proibidos.`);
