import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { tokenService, TokenService } from "../src/services/token.service.js";
import { UserRole } from "../src/types/models.js";
import { AppError } from "../src/utils/api-error.js";

describe("Cryptography & JWT Token Service (Task 3.1)", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const userRole = UserRole.PATIENT;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Access Token Behavior & Claims", () => {
    it("should issue a valid access token with sub, role, and type claims", () => {
      const token = tokenService.generateAccessToken(userId, userRole);

      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      const decoded = jwt.decode(token) as any;
      expect(decoded).toBeDefined();
      expect(decoded.sub).toBe(userId);
      expect(decoded.role).toBe(userRole);
      expect(decoded.type).toBe("access");
      expect(decoded.iss).toBe("lifeline-api");
    });

    it("should enforce a 15-minute expiration window on access tokens", () => {
      const token = tokenService.generateAccessToken(userId, userRole);
      const decoded = jwt.decode(token) as { iat: number; exp: number };

      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();

      const lifetimeSeconds = decoded.exp - decoded.iat;
      // 15 minutes = 900 seconds
      expect(lifetimeSeconds).toBe(15 * 60);
    });

    it("should successfully verify a valid access token", () => {
      const token = tokenService.generateAccessToken(userId, userRole);
      const payload = tokenService.verifyAccessToken(token);

      expect(payload.sub).toBe(userId);
      expect(payload.role).toBe(userRole);
      expect(payload.type).toBe("access");
      expect(payload.iss).toBe("lifeline-api");
    });

    it("should reject an access token with an invalid signature", () => {
      const fakeToken = jwt.sign(
        { sub: userId, role: userRole, type: "access" },
        "wrong_fake_secret_key_1234567890",
        { expiresIn: "15m", issuer: "lifeline-api" }
      );

      expect(() => tokenService.verifyAccessToken(fakeToken)).toThrow(AppError);

      try {
        tokenService.verifyAccessToken(fakeToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_TOKEN_INVALID");
        expect(err.statusCode).toBe(401);
      }
    });

    it("should reject an expired access token with AUTH_TOKEN_EXPIRED", () => {
      const expiredToken = jwt.sign(
        { sub: userId, role: userRole, type: "access" },
        env.JWT_ACCESS_SECRET,
        { expiresIn: -10, issuer: "lifeline-api" }
      );

      expect(() => tokenService.verifyAccessToken(expiredToken)).toThrow(AppError);

      try {
        tokenService.verifyAccessToken(expiredToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_TOKEN_EXPIRED");
        expect(err.statusCode).toBe(401);
      }
    });

    it("should reject a refresh token when passed to verifyAccessToken", () => {
      const refreshToken = tokenService.generateRefreshToken(
        userId,
        userRole,
        "family_123",
        "jti_123"
      );

      expect(() => tokenService.verifyAccessToken(refreshToken)).toThrow(AppError);

      try {
        tokenService.verifyAccessToken(refreshToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_TOKEN_INVALID");
        expect(err.statusCode).toBe(401);
      }
    });

    it("should reject empty or missing access token", () => {
      expect(() => tokenService.verifyAccessToken("")).toThrow(AppError);
      expect(() => tokenService.verifyAccessToken(null as unknown as string)).toThrow(AppError);

      try {
        tokenService.verifyAccessToken("");
      } catch (err: any) {
        expect(err.code).toBe("AUTH_TOKEN_MISSING");
      }
    });
  });

  describe("2. Refresh Token Behavior & Claims", () => {
    it("should issue a valid refresh token with sub, role, jti, familyId, and type claims", () => {
      const familyId = "fam_999";
      const jti = "jti_888";
      const token = tokenService.generateRefreshToken(userId, userRole, familyId, jti);

      const decoded = jwt.decode(token) as any;
      expect(decoded.sub).toBe(userId);
      expect(decoded.role).toBe(userRole);
      expect(decoded.familyId).toBe(familyId);
      expect(decoded.jti).toBe(jti);
      expect(decoded.type).toBe("refresh");
      expect(decoded.iss).toBe("lifeline-api");
    });

    it("should enforce a 7-day expiration window on refresh tokens", () => {
      const token = tokenService.generateRefreshToken(
        userId,
        userRole,
        "fam_999",
        "jti_888"
      );
      const decoded = jwt.decode(token) as { iat: number; exp: number };

      const lifetimeSeconds = decoded.exp - decoded.iat;
      // 7 days = 7 * 24 * 60 * 60 = 604800 seconds
      expect(lifetimeSeconds).toBe(7 * 24 * 60 * 60);
    });

    it("should successfully verify a valid refresh token", () => {
      const token = tokenService.generateRefreshToken(
        userId,
        userRole,
        "fam_999",
        "jti_888"
      );
      const payload = tokenService.verifyRefreshToken(token);

      expect(payload.sub).toBe(userId);
      expect(payload.role).toBe(userRole);
      expect(payload.familyId).toBe("fam_999");
      expect(payload.jti).toBe("jti_888");
      expect(payload.type).toBe("refresh");
    });

    it("should reject an expired refresh token with AUTH_REFRESH_TOKEN_EXPIRED", () => {
      const expiredToken = jwt.sign(
        { sub: userId, role: userRole, familyId: "fam_1", jti: "jti_1", type: "refresh" },
        env.JWT_REFRESH_SECRET,
        { expiresIn: -10, issuer: "lifeline-api" }
      );

      expect(() => tokenService.verifyRefreshToken(expiredToken)).toThrow(AppError);

      try {
        tokenService.verifyRefreshToken(expiredToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_REFRESH_TOKEN_EXPIRED");
        expect(err.statusCode).toBe(401);
      }
    });

    it("should reject an access token when passed to verifyRefreshToken", () => {
      const accessToken = tokenService.generateAccessToken(userId, userRole);

      expect(() => tokenService.verifyRefreshToken(accessToken)).toThrow(AppError);

      try {
        tokenService.verifyRefreshToken(accessToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_TOKEN_INVALID");
        expect(err.statusCode).toBe(401);
      }
    });
  });

  describe("3. Refresh Token Family Persistence & Generation", () => {
    it("should generate a token pair and persist the SHA-256 hashed refresh token in database", async () => {
      let createdDoc: any = null;
      vi.spyOn(RefreshToken, "create").mockImplementation(async (doc: any) => {
        createdDoc = doc;
        return new RefreshToken(doc);
      });

      const tokenPair = await tokenService.generateTokens({
        userId,
        role: userRole,
      });

      expect(tokenPair.accessToken).toBeDefined();
      expect(tokenPair.refreshToken).toBeDefined();
      expect(tokenPair.familyId).toBeDefined();

      // Verify database record creation
      expect(createdDoc).toBeDefined();
      expect(createdDoc.familyId).toBe(tokenPair.familyId);
      expect(createdDoc.isRevoked).toBe(false);
      expect(createdDoc.userId.toString()).toBe(userId);
      expect(createdDoc.expiresAt).toBeInstanceOf(Date);

      // Verify the stored hash is NOT the plaintext refresh token
      expect(createdDoc.tokenHash).not.toBe(tokenPair.refreshToken);
      expect(createdDoc.tokenHash).toBe(tokenService.hashToken(tokenPair.refreshToken));
      expect(createdDoc.tokenHash.length).toBe(64); // SHA-256 hex length
    });

    it("should preserve custom familyId when supplied during token pair generation", async () => {
      const customFamilyId = "custom_device_family_456";
      let createdDoc: any = null;
      vi.spyOn(RefreshToken, "create").mockImplementation(async (doc: any) => {
        createdDoc = doc;
        return new RefreshToken(doc);
      });

      const tokenPair = await tokenService.generateTokens({
        userId,
        role: userRole,
        familyId: customFamilyId,
      });

      expect(tokenPair.familyId).toBe(customFamilyId);
      expect(createdDoc.familyId).toBe(customFamilyId);
    });
  });

  describe("4. Refresh Token Rotation & Invalidation", () => {
    it("should rotate an active refresh token, mark the prior token as revoked, and issue a new pair in the same family", async () => {
      const inMemoryTokens = new Map<string, any>();

      vi.spyOn(RefreshToken, "create").mockImplementation(async (doc: any) => {
        const docObj = {
          ...doc,
          _id: new mongoose.Types.ObjectId(),
          save: vi.fn().mockResolvedValue(true),
        };
        inMemoryTokens.set(doc.jti, docObj);
        return docObj as any;
      });

      vi.spyOn(RefreshToken, "findOne").mockImplementation(async (query: any) => {
        return inMemoryTokens.get(query.jti) || null;
      });

      // Step 1: Initial token generation
      const initialTokens = await tokenService.generateTokens({
        userId,
        role: userRole,
      });

      const initialPayload = tokenService.verifyRefreshToken(initialTokens.refreshToken);
      const initialDoc = inMemoryTokens.get(initialPayload.jti);
      expect(initialDoc.isRevoked).toBe(false);

      // Step 2: Rotate the refresh token
      const rotated = await tokenService.rotateRefreshToken(initialTokens.refreshToken);

      expect(rotated).toBeDefined();
      expect(rotated.familyId).toBe(initialTokens.familyId);
      expect(rotated.refreshToken).not.toBe(initialTokens.refreshToken);
      expect(rotated.accessToken).not.toBe(initialTokens.accessToken);
      expect(rotated.user.id).toBe(userId);
      expect(rotated.user.role).toBe(userRole);

      // Step 3: Prior token must now be marked as revoked
      expect(initialDoc.isRevoked).toBe(true);
      expect(initialDoc.replacedByJti).toBeDefined();

      // Step 4: New token must be active in memory map
      const newPayload = tokenService.verifyRefreshToken(rotated.refreshToken);
      const newDoc = inMemoryTokens.get(newPayload.jti);
      expect(newDoc).toBeDefined();
      expect(newDoc.isRevoked).toBe(false);
      expect(newDoc.familyId).toBe(initialTokens.familyId);
    });
  });

  describe("5. Refresh Token Reuse Detection & Family Revocation", () => {
    it("should detect reuse when a revoked token is rotated, revoking the entire token family", async () => {
      const updateManySpy = vi.spyOn(RefreshToken, "updateMany").mockResolvedValue({
        acknowledged: true,
        matchedCount: 2,
        modifiedCount: 2,
        upsertedCount: 0,
        upsertedId: null,
      });

      const familyId = "compromised_family_789";
      const oldJti = "old_rotated_jti_111";

      const oldRefreshToken = tokenService.generateRefreshToken(
        userId,
        userRole,
        familyId,
        oldJti
      );

      // Mock database returning the token as already revoked (e.g. from prior rotation)
      vi.spyOn(RefreshToken, "findOne").mockResolvedValue({
        userId: new mongoose.Types.ObjectId(userId),
        familyId,
        jti: oldJti,
        tokenHash: tokenService.hashToken(oldRefreshToken),
        isRevoked: true, // ALREADY REVOKED!
        expiresAt: new Date(Date.now() + 100000),
      } as any);

      // Attempting to rotate this already-revoked token must trigger reuse detection
      await expect(tokenService.rotateRefreshToken(oldRefreshToken)).rejects.toThrow(AppError);

      try {
        await tokenService.rotateRefreshToken(oldRefreshToken);
      } catch (err: any) {
        expect(err.code).toBe("AUTH_REFRESH_TOKEN_REVOKED");
        expect(err.statusCode).toBe(401);
        expect(err.message).toMatch(/reuse detected/i);
      }

      // Entire family must have been revoked
      expect(updateManySpy).toHaveBeenCalledWith(
        { familyId },
        { $set: { isRevoked: true } }
      );
    });

    it("should revoke token family if the token record is missing from database", async () => {
      const updateManySpy = vi.spyOn(RefreshToken, "updateMany").mockResolvedValue({} as any);

      const familyId = "unknown_token_family_000";
      const unknownToken = tokenService.generateRefreshToken(
        userId,
        userRole,
        familyId,
        "missing_jti"
      );

      vi.spyOn(RefreshToken, "findOne").mockResolvedValue(null);

      await expect(tokenService.rotateRefreshToken(unknownToken)).rejects.toThrow(AppError);

      expect(updateManySpy).toHaveBeenCalledWith(
        { familyId },
        { $set: { isRevoked: true } }
      );
    });
  });

  describe("6. Revocation Operations", () => {
    it("should revoke all tokens in a family when revokeFamily is called", async () => {
      const updateManySpy = vi.spyOn(RefreshToken, "updateMany").mockResolvedValue({} as any);

      await tokenService.revokeFamily("fam_to_revoke_123");

      expect(updateManySpy).toHaveBeenCalledWith(
        { familyId: "fam_to_revoke_123" },
        { $set: { isRevoked: true } }
      );
    });

    it("should revoke all user tokens across all devices when revokeAllUserTokens is called", async () => {
      const updateManySpy = vi.spyOn(RefreshToken, "updateMany").mockResolvedValue({} as any);
      const targetUserId = new mongoose.Types.ObjectId();

      await tokenService.revokeAllUserTokens(targetUserId);

      expect(updateManySpy).toHaveBeenCalledWith(
        { userId: targetUserId },
        { $set: { isRevoked: true } }
      );
    });

    it("should revoke a specific token when revokeToken is called", async () => {
      const updateOneSpy = vi.spyOn(RefreshToken, "updateOne").mockResolvedValue({} as any);

      const rawToken = tokenService.generateRefreshToken(
        userId,
        userRole,
        "fam_single",
        "jti_to_kill"
      );

      await tokenService.revokeToken(rawToken);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { jti: "jti_to_kill" },
        { $set: { isRevoked: true } }
      );
    });
  });

  describe("7. Security Guardrails", () => {
    it("should verify access and refresh secrets are distinct", () => {
      expect(env.JWT_ACCESS_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    });

    it("should never include passwords or sensitive data in JWT payloads", () => {
      const accessToken = tokenService.generateAccessToken(userId, userRole);
      const refreshToken = tokenService.generateRefreshToken(
        userId,
        userRole,
        "fam_safe",
        "jti_safe"
      );

      const accessPayload = jwt.decode(accessToken) as Record<string, any>;
      const refreshPayload = jwt.decode(refreshToken) as Record<string, any>;

      const sensitiveKeys = [
        "password",
        "passwordHash",
        "secret",
        "medical",
        "diagnosis",
        "payment",
      ];

      for (const key of sensitiveKeys) {
        expect(accessPayload[key]).toBeUndefined();
        expect(refreshPayload[key]).toBeUndefined();
      }
    });
  });

  describe("8. RefreshToken Mongoose Model Schema Validation", () => {
    it("should validate a valid RefreshToken document with defaults", () => {
      const tokenDoc = new RefreshToken({
        userId: new mongoose.Types.ObjectId(),
        familyId: "fam_model_test",
        jti: "jti_model_test",
        tokenHash: "f".repeat(64),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const validationErr = tokenDoc.validateSync();
      expect(validationErr).toBeUndefined();
      expect(tokenDoc.isRevoked).toBe(false);
    });

    it("should enforce required fields on RefreshToken schema", () => {
      const invalidDoc = new RefreshToken({});
      const err = invalidDoc.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["userId"]).toBeDefined();
      expect(err?.errors["familyId"]).toBeDefined();
      expect(err?.errors["jti"]).toBeDefined();
      expect(err?.errors["tokenHash"]).toBeDefined();
      expect(err?.errors["expiresAt"]).toBeDefined();
    });
  });
});
