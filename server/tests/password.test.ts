import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, comparePassword, BCRYPT_ROUNDS } from "../src/utils/password.js";
import { AppError } from "../src/utils/api-error.js";

describe("Password Hashing & Cryptography Helpers (Task 3.1)", () => {
  const testPassword = "SecureP@ssw0rd!2026#Healthcare";

  it("should have BCRYPT_ROUNDS set to 12", () => {
    expect(BCRYPT_ROUNDS).toBe(12);
  });

  it("should produce a secure, non-plaintext bcrypt hash", async () => {
    const hash = await hashPassword(testPassword);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(testPassword);
    expect(hash.length).toBeGreaterThan(50);
  });

  it("should use bcrypt cost factor 12", async () => {
    const hash = await hashPassword(testPassword);

    // Verify bcrypt standard format: $2a$12$... or $2b$12$...
    expect(hash).toMatch(/^\$2[aby]\$12\$/);

    // Verify using bcrypt's internal getRounds
    const rounds = bcrypt.getRounds(hash);
    expect(rounds).toBe(12);
  });

  it("should generate unique salts and different hashes for identical passwords", async () => {
    const hash1 = await hashPassword(testPassword);
    const hash2 = await hashPassword(testPassword);

    expect(hash1).not.toBe(hash2);
    expect(await comparePassword(testPassword, hash1)).toBe(true);
    expect(await comparePassword(testPassword, hash2)).toBe(true);
  });

  it("should successfully verify the correct password", async () => {
    const hash = await hashPassword(testPassword);
    const isValid = await comparePassword(testPassword, hash);

    expect(isValid).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const hash = await hashPassword(testPassword);
    const isValid = await comparePassword("WrongPassword123!", hash);

    expect(isValid).toBe(false);
  });

  it("should reject empty, whitespace-only, or non-string passwords when hashing", async () => {
    await expect(hashPassword("")).rejects.toThrow(AppError);
    await expect(hashPassword("   ")).rejects.toThrow(AppError);
    await expect(hashPassword(null as unknown as string)).rejects.toThrow(AppError);
    await expect(hashPassword(undefined as unknown as string)).rejects.toThrow(AppError);

    try {
      await hashPassword("");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VALIDATION_ERROR");
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it("should return false safely without throwing on invalid inputs to comparePassword", async () => {
    const hash = await hashPassword(testPassword);

    expect(await comparePassword("", hash)).toBe(false);
    expect(await comparePassword("   ", hash)).toBe(false);
    expect(await comparePassword(testPassword, "")).toBe(false);
    expect(await comparePassword(testPassword, "invalid_corrupted_hash")).toBe(false);
    expect(await comparePassword(null as unknown as string, hash)).toBe(false);
    expect(await comparePassword(testPassword, null as unknown as string)).toBe(false);
  });
});
