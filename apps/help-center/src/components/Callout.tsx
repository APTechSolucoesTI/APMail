import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function Callout({ tone, title, children }: { tone: 'tip' | 'warning' | 'info'; title: string; children: ReactNode }) {
  const Icon = tone === 'tip' ? Lightbulb : tone === 'warning' ? TriangleAlert : Info;
  return <aside className={`callout ${tone}`}><Icon size={19} aria-hidden /><div><strong>{title}</strong><div>{children}</div></div></aside>;
}
