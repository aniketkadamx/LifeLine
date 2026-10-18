import { BrowserRouter } from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "./routes/AppRoutes";

/**
 * Shared QueryClient instance configured with resilient healthcare caching policies.
 * Prevents re-instantiation across renders.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh data window
      gcTime: 1000 * 60 * 30, // 30 minutes cache garbage collection
      retry: (failureCount, error: any) => {
        // Do not repeat queries failing due to authorization or client error
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
