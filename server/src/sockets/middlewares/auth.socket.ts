import type { Socket } from "socket.io";
import { tokenService } from "../../services/token.service.js";
import { User } from "../../models/user.model.js";
import { UserRole, UserStatus } from "../../types/models.js";
import { AppError } from "../../utils/api-error.js";

/**
 * Strongly typed user context attached to authenticated sockets.
 */
export interface SocketUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  email: string;
}

declare module "socket.io" {
  interface Socket {
    user?: SocketUser;
  }
}

/**
 * Socket.IO handshake authentication middleware.
 *
 * Enforces:
 * 1. Presence of JWT access token in `socket.handshake.auth.token` (or Bearer Authorization header).
 * 2. Cryptographic signature and expiration verification via existing `tokenService.verifyAccessToken`.
 * 3. Enforces access-type claims and rejects refresh tokens.
 * 4. Loads persisted user from MongoDB and enforces `UserStatus.ACTIVE`.
 * 5. Attaches trusted, server-derived `socket.user` context.
 * 6. Emits generic, safe error messages without revealing internal verification secrets.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    // 1. Extract token from handshake auth or headers
    let token: string | undefined = socket.handshake.auth?.token;

    if (!token && socket.handshake.headers?.authorization) {
      const parts = socket.handshake.headers.authorization.trim().split(/\s+/);
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
      }
    }

    if (!token || typeof token !== "string" || !token.trim()) {
      return next(new Error("Authentication token is required"));
    }

    // 2. Cryptographically verify access token using existing M3 token service
    let payload;
    try {
      payload = tokenService.verifyAccessToken(token.trim());
    } catch (error: unknown) {
      if (
        error instanceof AppError &&
        error.code === "AUTH_TOKEN_EXPIRED"
      ) {
        return next(new Error("Authentication token expired"));
      }
      return next(new Error("Authentication token invalid"));
    }

    // 3. Database-backed user verification
    const user = await User.findById(payload.sub).select(
      "_id email role status"
    );

    if (!user) {
      return next(new Error("Authentication failed"));
    }

    // 4. Enforce active account status
    if (user.status !== UserStatus.ACTIVE) {
      return next(new Error("Authentication failed: account is not active"));
    }

    // 5. Attach strongly typed trusted user context
    socket.user = {
      id: user._id.toString(),
      role: user.role,
      status: user.status,
      email: user.email,
    };

    next();
  } catch (error: unknown) {
    return next(new Error("Authentication failed"));
  }
}
