import { Mail } from 'lucide-react';
import { PageHeader } from './page-header';
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-card">
        <div className="mb-6 flex items-center gap-2 text-xl font-semibold text-primary">
          <Mail aria-hidden />
          APMail
        </div>
        <PageHeader title={title} description={description} />
        {children}
      </section>
    </main>
  );
}
