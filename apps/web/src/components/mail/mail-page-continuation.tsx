import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export function MailPageContinuation({
  hasNextPage,
  isFetching,
  isFetchNextPageError,
  fetchNextPage,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !hasNextPage ||
      isFetching ||
      isFetchNextPageError ||
      !sentinel.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void fetchNextPage();
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);
  if (!hasNextPage) return null;
  return (
    <div ref={sentinel} className="flex justify-center p-3">
      <Button
        type="button"
        variant="outline"
        disabled={isFetching}
        onClick={() => void fetchNextPage()}
      >
        {isFetching
          ? 'Carregando…'
          : isFetchNextPageError
            ? 'Tentar carregar mais'
            : 'Carregar mais e-mails'}
      </Button>
    </div>
  );
}
