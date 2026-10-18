import { create } from "zustand";
import type { AuthState, AuthUser } from "../types/auth";

/**
 * Pure in-memory Zustand authentication store.
 *
 * Security Policies:
 * 1. Tokens and session credentials are strictly stored in memory (never written
 *    to localStorage or sessionStorage to prevent XSS exfiltration).
 * 2. Refresh tokens are maintained exclusively in HttpOnly cookies managed by the browser.
 * 3. Logout completely purges user context and access tokens.
 * 4. Tokens are never logged to console or audit streams.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,

  login: (user: AuthUser, accessToken: string) => {
    set({
      user,
      accessToken,
      isAuthenticated: true,
    });
  },

  setAccessToken: (accessToken: string | null) => {
    set((state) => ({
      accessToken,
      isAuthenticated: Boolean(accessToken && state.user),
    }));
  },

  logout: () => {
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  },
}));
