import { Menu, Search, ExternalLink } from 'lucide-react';
import { Brand } from './Brand';

export function Header({ onSearch, onMenu }: { onSearch: () => void; onMenu: () => void }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="icon-button mobile-menu" type="button" aria-label="Abrir menu" onClick={onMenu}><Menu size={20} /></button>
        <Brand />
        <div className="header-spacer" />
        <button className="header-search" type="button" onClick={onSearch} aria-label="Pesquisar na documentação">
          <Search size={17} /><span>Pesquisar na documentação...</span><kbd>Ctrl K</kbd>
        </button>
        <a className="product-link" href="https://app.apmail.com.br" target="_blank" rel="noreferrer">Acessar APMail <ExternalLink size={14} /></a>
      </div>
    </header>
  );
}
