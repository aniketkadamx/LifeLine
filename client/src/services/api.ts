import { useAuthStore } from "../stores/auth.store";

export class ApiError extends Error {
  public status: number;
  public code?: string;
  public data?: unknown;

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
  skipAuth?: boolean;
  _retry?: boolean;
}

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, "")
    : "") || "/api/v1";

/**
 * Shared in-flight refresh promise to prevent duplicate concurrent refresh requests.
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Optional navigation callback injected by routing layers to avoid hard window reloads.
 */
let onAuthFailureCallback: (() => void) | null = null;

export function setOnAuthFailure(callback: (() => void) | null): void {
  onAuthFailureCallback = callback;
}

/**
 * Safely redirects the browser to /login on unrecoverable authentication expiry.
 */
function handleAuthFailure(): void {
  useAuthStore.getState().logout();

  if (onAuthFailureCallback) {
    onAuthFailureCallback();
    return;
  }

  if (typeof window !== "undefined") {
    const currentPath = window.location.pathname;
    if (currentPath !== "/login" && currentPath !== "/register") {
      const redirectParam = encodeURIComponent(currentPath + window.location.search);
      window.location.assign(`/login?redirect=${redirectParam}`);
    }
  }
}

/**
 * Resolves a normalized API endpoint URL.
 */
function resolveUrl(endpoint: string, params?: RequestOptions["params"]): string {
  let url = endpoint;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
      const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
      if (cleanEndpoint.startsWith("/api/v1")) {
        url = `${API_BASE_URL}${cleanEndpoint.slice(7)}`;
      } else {
        url = `${API_BASE_URL}${cleanEndpoint}`;
      }
    } else {
      if (!url.startsWith(API_BASE_URL)) {
        url = `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
      }
    }
  }

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  return url;
}

/**
 * Executes a token refresh request against POST /api/v1/auth/refresh-token.
 * Uses HttpOnly cookie credentials and coalesces concurrent requests.
 */
export async function silentRefreshToken(): Promise<string | null> {
  // If refresh is already in-flight, await the existing promise
  if (refreshPromise) {
    return refreshPromise;
  }

  // Record user state before dispatching refresh to detect race conditions with logout
  const userBeforeRefresh = useAuthStore.getState().user;

  refreshPromise = (async () => {
    try {
      const res = await fetch(resolveUrl("/auth/refresh-token"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!res.ok) {
        handleAuthFailure();
        return null;
      }

      const json = await res.json();
      const newAccessToken = json?.data?.accessToken;

      if (!newAccessToken || typeof newAccessToken !== "string") {
        handleAuthFailure();
        return null;
      }

      // Check if user logged out while refresh was in-flight
      const currentUser = useAuthStore.getState().user;
      if (!currentUser || (userBeforeRefresh && currentUser.id !== userBeforeRefresh.id)) {
        // Late response after logout: do NOT restore session!
        return null;
      }

      // Update in-memory Zustand access token
      useAuthStore.getState().setAccessToken(newAccessToken);
      return newAccessToken;
    } catch {
      handleAuthFailure();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Primary HTTP request dispatcher with automatic authorization injection,
 * credential management, and resilient 401 token refresh retry.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const resolvedUrl = resolveUrl(endpoint, options.params);
  const headers = new Headers(options.headers || {});

  // 1. Attach in-memory access token if not explicitly skipped
  const accessToken = useAuthStore.getState().accessToken;
  if (!options.skipAuth && accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  // Set default JSON Content-Type when payload is present and not FormData
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials || "include", // Required for HttpOnly refresh cookie exchange
  };

  const response = await fetch(resolvedUrl, fetchOptions);

  // 2. Handle HTTP 401 Silent Refresh and Request Replay
  if (response.status === 401) {
    const isAuthRoute =
      resolvedUrl.includes("/auth/login") ||
      resolvedUrl.includes("/auth/register") ||
      resolvedUrl.includes("/auth/refresh-token");

    // Do NOT refresh on login/register failures or repeated retries
    if (!options._retry && !isAuthRoute) {
      const refreshedToken = await silentRefreshToken();

      if (refreshedToken) {
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);

        if (
          options.body &&
          !(options.body instanceof FormData) &&
          !retryHeaders.has("Content-Type")
        ) {
          retryHeaders.set("Content-Type", "application/json");
        }

        // Retry original request exactly once
        return apiRequest<T>(endpoint, {
          ...options,
          headers: retryHeaders,
          _retry: true,
        });
      }
    }
  }

  // 3. Parse and handle responses
  const contentType = response.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage =
      (isJson && (data?.error?.message || data?.message)) ||
      response.statusText ||
      `Request failed with status ${response.status}`;
    const errorCode = isJson ? (data?.error?.code || data?.code) : undefined;

    throw new ApiError(errorMessage, response.status, errorCode, data);
  }

  return data as T;
}

/**
 * Convenient REST action methods.
 */
export const api = {
  get: <T = any>(url: string, options?: RequestOptions) =>
    apiRequest<T>(url, { ...options, method: "GET" }),

  post: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: "POST",
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  put: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: "PUT",
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  patch: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: "PATCH",
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  delete: <T = any>(url: string, options?: RequestOptions) =>
    apiRequest<T>(url, { ...options, method: "DELETE" }),
};
