try {
  const theme = window.localStorage.getItem('apmail-theme') || 'system';
  window.document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
} catch {
  // O tema padrão continua utilizável quando o navegador bloqueia o armazenamento.
}
