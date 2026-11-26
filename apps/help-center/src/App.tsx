import { useEffect, useState } from 'react';
import { ArrowLeft, Menu, Search } from 'lucide-react';
import { articles, getArticle } from './content';
import { CategorySidebar } from './components/CategorySidebar';
import { Header } from './components/Header';
import { HomePage } from './components/HomePage';
import { ArticlePage } from './components/ArticlePage';
import { SearchDialog } from './components/SearchDialog';

function currentArticle() {
  const match = window.location.pathname.match(/^\/docs\/([^/]+)\/([^/]+)\/?$/);
  return match ? getArticle(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!)) : undefined;
}

export function App() {
  const [article, setArticle] = useState(currentArticle);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const update = () => setArticle(currentArticle());
    window.addEventListener('popstate', update);
    const hotkey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', hotkey);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('keydown', hotkey); };
  }, []);
  useEffect(() => {
    const title = article ? `${article.title} | Ajuda APMail` : 'Central de Ajuda APMail';
    document.title = title;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute('content', article?.description ?? 'Aprenda a configurar e usar o APMail. Guias práticos para administradores e equipes.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', `https://ajuda.apmail.com.br${article ? `/docs/${article.category}/${article.slug}/` : '/'}`);
  }, [article]);
  return <>
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
    <Header onSearch={() => setSearchOpen(true)} onMenu={() => setMobileOpen(true)} />
    {article ? <div className="docs-layout"><CategorySidebar article={article} open={mobileOpen} onClose={() => setMobileOpen(false)} /><main id="main-content" className="docs-content"><ArticlePage article={article} /></main></div> : window.location.pathname === '/' ? <div id="main-content"><HomePage onSearch={() => setSearchOpen(true)} /></div> : <main className="not-found"><div className="not-found-mark">404</div><h1>Não encontramos esta página</h1><p>O artigo pode ter mudado de endereço ou não estar disponível.</p><a href="/"><ArrowLeft size={16} /> Voltar à Central de Ajuda</a></main>}
    <footer className="site-footer"><span>APMail <span className="footer-separator">/</span> Central de Ajuda</span><span>Documentação para sua rotina de e-mail.</span></footer>
    <SearchDialog articles={articles} open={searchOpen} onClose={() => setSearchOpen(false)} />
    {mobileOpen && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
    <button className="floating-search" onClick={() => setSearchOpen(true)} aria-label="Pesquisar"><Search size={17} /></button>
  </>;
}
