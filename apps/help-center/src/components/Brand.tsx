import { Mail } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Central de Ajuda APMail — início">
      <span className="brand-mark"><Mail size={18} strokeWidth={2.4} /></span>
      <span className="brand-copy"><strong>APMail</strong><span>Ajuda</span></span>
    </a>
  );
}
