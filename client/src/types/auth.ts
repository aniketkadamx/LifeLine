/**
 * Core authentication and role types for the LifeLine platform.
 * Aligns strictly with backend models in server/src/types/models.ts and AUTHORIZATION_MATRIX.md.
 */

export type UserRole = "PATIENT" | "DOCTOR" | "PHARMACY" | "ADMIN";

export type UserStatus =
  | "ACTIVE"
  | "PENDING_VERIFICATION"
  | "SUSPENDED"
  | "DEACTIVATED";

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status?: UserStatus;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (accessToken: string | null) => void;
  logout: () => void;
}
