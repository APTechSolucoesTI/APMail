import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    mutations: { retry: 0 },
  },
});
