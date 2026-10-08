import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/refresh-token.model.js";
import { UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";

/**
 * Standard access token JWT claims payload.
 */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: "access";
  jti?: string;
  iss?: string;
  iat?: number;
  exp?: number;
}

/**
 * Standard refresh token JWT claims payload.
 */
export interface RefreshTokenPayload {
  sub: string;
  role: UserRole;
  jti: string;
  familyId: string;
  type: "refresh";
  iss?: string;
  iat?: number;
  exp?: number;
}

/**
 * Issued token pair returned to caller.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  familyId: string;
}

/**
 * Options for generating a new token pair.
 */
export interface GenerateTokensOptions {
  userId: string | mongoose.Types.ObjectId;
  role: UserRole;
  familyId?: string;
}

/**
 * Return type for token rotation.
 */
export interface RotateTokenResult extends TokenPair {
  user: {
    id: string;
    role: UserRole;
  };
}

/**
 * Reusable JWT and cryptographic token service.
 * Manages access token issuance, refresh token families, secure rotation, and reuse detection.
 */
export class TokenService {
  private readonly issuer = "lifeline-api";

  /**
   * Hashes a raw refresh token using SHA-256 for secure, non-reversible database storage.
   */
  public hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generates a short-lived (15-minute) access token with a unique jti.
   */
  public generateAccessToken(userId: string, role: UserRole): string {
    const payload: Omit<AccessTokenPayload, "iat" | "exp"> = {
      sub: userId,
      role,
      type: "access",
      jti: crypto.randomUUID(),
    };

    const signOptions: SignOptions = {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
      issuer: this.issuer,
    };

    return jwt.sign(payload, env.JWT_ACCESS_SECRET, signOptions);
  }

  /**
   * Generates a long-lived (7-day) refresh token with unique jti and familyId.
   */
  public generateRefreshToken(userId: string, role: UserRole, familyId: string, jti: string): string {
    const payload: Omit<RefreshTokenPayload, "iat" | "exp"> = {
      sub: userId,
      role,
      jti,
      familyId,
      type: "refresh",
    };

    const signOptions: SignOptions = {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
      issuer: this.issuer,
    };

    return jwt.sign(payload, env.JWT_REFRESH_SECRET, signOptions);
  }

  /**
   * Generates an access token and a refresh token, recording the refresh token family state in MongoDB.
   */
  public async generateTokens(options: GenerateTokensOptions): Promise<TokenPair> {
    const userIdStr = options.userId.toString();
    const familyId = options.familyId || crypto.randomUUID();
    const jti = crypto.randomUUID();

    const accessToken = this.generateAccessToken(userIdStr, options.role);
    const refreshToken = this.generateRefreshToken(userIdStr, options.role, familyId, jti);

    // Compute cryptographic hash of the refresh token
    const tokenHash = this.hashToken(refreshToken);

    // Extract exact expiration timestamp from decoded token
    const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Persist refresh token family member in database
    await RefreshToken.create({
      userId: new mongoose.Types.ObjectId(userIdStr),
      familyId,
      jti,
      tokenHash,
      isRevoked: false,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      familyId,
    };
  }

  /**
   * Cryptographically verifies an access token.
   * Enforces type === "access", correct signature, valid issuer, and claims presence.
   */
  public verifyAccessToken(token: string): AccessTokenPayload {
    if (!token || typeof token !== "string") {
      throw AppError.unauthorized("Access token is required", "AUTH_TOKEN_MISSING");
    }

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: this.issuer,
      }) as unknown as AccessTokenPayload;

      if (!decoded || typeof decoded !== "object" || decoded.type !== "access" || !decoded.sub || !decoded.role) {
        throw AppError.unauthorized("Invalid access token claims or type", "AUTH_TOKEN_INVALID");
      }

      return decoded;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw AppError.unauthorized("Access token has expired", "AUTH_TOKEN_EXPIRED");
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw AppError.unauthorized("Invalid access token signature or format", "AUTH_TOKEN_INVALID");
      }
      throw AppError.unauthorized("Authentication token verification failed", "AUTH_TOKEN_INVALID");
    }
  }

  /**
   * Cryptographically verifies a refresh token.
   * Enforces type === "refresh", correct signature, valid issuer, and claims presence.
   */
  public verifyRefreshToken(token: string): RefreshTokenPayload {
    if (!token || typeof token !== "string") {
      throw AppError.unauthorized("Refresh token is required", "AUTH_TOKEN_MISSING");
    }

    try {
      const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
        issuer: this.issuer,
      }) as unknown as RefreshTokenPayload;

      if (
        !decoded ||
        typeof decoded !== "object" ||
        decoded.type !== "refresh" ||
        !decoded.sub ||
        !decoded.role ||
        !decoded.jti ||
        !decoded.familyId
      ) {
        throw AppError.unauthorized("Invalid refresh token claims or type", "AUTH_TOKEN_INVALID");
      }

      return decoded;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw AppError.unauthorized("Refresh token has expired", "AUTH_REFRESH_TOKEN_EXPIRED");
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw AppError.unauthorized("Invalid refresh token signature or format", "AUTH_TOKEN_INVALID");
      }
      throw AppError.unauthorized("Refresh token verification failed", "AUTH_TOKEN_INVALID");
    }
  }

  /**
   * Rotates a refresh token while performing reuse detection.
   *
   * Flow:
   * 1. Cryptographically verify presented token.
   * 2. Look up token in database by jti.
   * 3. If token is missing or already marked isRevoked -> REUSE DETECTED: revoke entire family and reject.
   * 4. If token is active: revoke it and issue a new pair in the same family.
   */
  public async rotateRefreshToken(rawRefreshToken: string): Promise<RotateTokenResult> {
    const payload = this.verifyRefreshToken(rawRefreshToken);
    const tokenHash = this.hashToken(rawRefreshToken);

    const tokenRecord = await RefreshToken.findOne({ jti: payload.jti });

    // Case 1: Token not found in database -> Revoke entire family to mitigate theft
    if (!tokenRecord) {
      await this.revokeFamily(payload.familyId);
      throw AppError.unauthorized(
        "Refresh token record not found. Token family revoked.",
        "AUTH_REFRESH_TOKEN_REVOKED"
      );
    }

    // Case 2: Token is already revoked -> REUSE DETECTED!
    if (tokenRecord.isRevoked) {
      await this.revokeFamily(payload.familyId);
      throw AppError.unauthorized(
        "Refresh token reuse detected. All sessions in this family have been revoked.",
        "AUTH_REFRESH_TOKEN_REVOKED"
      );
    }

    // Case 3: Token hash mismatch (unexpected cryptographic tampering)
    if (tokenRecord.tokenHash !== tokenHash) {
      await this.revokeFamily(payload.familyId);
      throw AppError.unauthorized(
        "Refresh token verification failed. Token family revoked.",
        "AUTH_REFRESH_TOKEN_REVOKED"
      );
    }

    // Case 4: Token is valid and active. Perform secure rotation.
    const newJti = crypto.randomUUID();
    tokenRecord.isRevoked = true;
    tokenRecord.replacedByJti = newJti;
    await tokenRecord.save();

    // Issue new tokens in the SAME token family
    const newAccessToken = this.generateAccessToken(payload.sub, payload.role);
    const newRefreshToken = this.generateRefreshToken(payload.sub, payload.role, payload.familyId, newJti);
    const newTokenHash = this.hashToken(newRefreshToken);

    const decoded = jwt.decode(newRefreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await RefreshToken.create({
      userId: new mongoose.Types.ObjectId(payload.sub),
      familyId: payload.familyId,
      jti: newJti,
      tokenHash: newTokenHash,
      isRevoked: false,
      expiresAt,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      familyId: payload.familyId,
      user: {
        id: payload.sub,
        role: payload.role,
      },
    };
  }

  /**
   * Revokes an entire refresh token family.
   * Invoked upon reuse detection or manual session termination.
   */
  public async revokeFamily(familyId: string): Promise<void> {
    if (!familyId) return;
    await RefreshToken.updateMany({ familyId }, { $set: { isRevoked: true } });
  }

  /**
   * Revokes all refresh tokens belonging to a user (across all devices/sessions).
   */
  public async revokeAllUserTokens(userId: string | mongoose.Types.ObjectId): Promise<void> {
    if (!userId) return;
    const objectId = typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;
    await RefreshToken.updateMany({ userId: objectId }, { $set: { isRevoked: true } });
  }

  /**
   * Revokes a single refresh token by raw token (e.g. on standard user logout).
   */
  public async revokeToken(rawRefreshToken: string): Promise<void> {
    try {
      const payload = this.verifyRefreshToken(rawRefreshToken);
      await RefreshToken.updateOne({ jti: payload.jti }, { $set: { isRevoked: true } });
    } catch {
      // If the token is already invalid/expired, nothing to revoke
    }
  }
}

export const tokenService = new TokenService();
