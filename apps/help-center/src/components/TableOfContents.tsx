import type { Heading } from '../lib/types';

export function TableOfContents({ headings }: { headings: Heading[] }) {
  if (!headings.length) return null;
  return <aside className="toc" aria-label="Nesta página"><strong>Nesta página</strong><nav>{headings.map((heading) => <a className={heading.level === 3 ? 'toc-sub' : ''} href={`#${heading.id}`} key={heading.id}>{heading.text}</a>)}</nav><div className="support-card"><span className="support-orb">?</span><strong>Precisa de ajuda?</strong><span>Fale com a equipe responsável pela sua empresa.</span><a href="https://app.apmail.com.br" target="_blank" rel="noreferrer">Abrir APMail</a></div></aside>;
}
