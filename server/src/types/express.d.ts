import { UserRole } from "./models.js";

/**
 * Strongly typed payload representing the authenticated user attached to Express.Request.
 */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  tokenId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
