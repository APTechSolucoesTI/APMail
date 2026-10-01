import { createFileRoute, Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
export const Route = createFileRoute('/')({ component: Home });
function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border bg-card p-8 text-card-foreground shadow-card">
        <Mail className="mb-4 size-10 text-primary" aria-hidden="true" />
        <h1 className="text-3xl font-bold">APMail</h1>
        <p className="mt-2 text-muted-foreground">Gestão de e-mails compartilhados do Grupo AP.</p>
        {import.meta.env.DEV && (
          <Link
            className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
            to="/_dev/ui"
            search={{ page: 1, pageSize: 10, filters: {} }}
          >
            Explorar componentes
          </Link>
        )}
      </section>
    </main>
  );
}
