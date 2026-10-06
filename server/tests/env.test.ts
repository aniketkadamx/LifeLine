import { describe, it, expect } from "vitest";
import { validateEnv, envSchema } from "../src/config/env.js";

describe("Environment Configuration & Validation (Task 0.1)", () => {
  const validBaseEnv = {
    NODE_ENV: "test",
    PORT: "5001",
    CLIENT_URL: "http://localhost:5173",
    MONGODB_URI: "mongodb://localhost:27017/lifeline_test",
    JWT_ACCESS_SECRET: "super_secret_access_token_key_12345",
    JWT_REFRESH_SECRET: "super_secret_refresh_token_key_67890",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  };

  it("should successfully validate and parse a complete, valid configuration", () => {
    const config = validateEnv(validBaseEnv);

    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(5001); // coerced to number
    expect(config.CLIENT_URL).toBe("http://localhost:5173");
    expect(config.MONGODB_URI).toBe("mongodb://localhost:27017/lifeline_test");
    expect(config.JWT_ACCESS_SECRET).toBe("super_secret_access_token_key_12345");
    expect(config.JWT_REFRESH_SECRET).toBe("super_secret_refresh_token_key_67890");
    expect(config.JWT_ACCESS_EXPIRES_IN).toBe("15m");
    expect(config.JWT_REFRESH_EXPIRES_IN).toBe("7d");
  });

  it("should apply default values when optional/defaulted fields are omitted", () => {
    const minimalEnv = {
      MONGODB_URI: "mongodb://localhost:27017/lifeline",
      JWT_ACCESS_SECRET: "access_secret_longer_than_16_chars",
      JWT_REFRESH_SECRET: "refresh_secret_longer_than_16_chars",
    };

    const config = validateEnv(minimalEnv);

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(5001);
    expect(config.CLIENT_URL).toBe("http://localhost:5173");
    expect(config.JWT_ACCESS_EXPIRES_IN).toBe("15m");
    expect(config.JWT_REFRESH_EXPIRES_IN).toBe("7d");
  });

  it("should fail fast when a mandatory variable (MONGODB_URI) is missing", () => {
    const missingDb = { ...validBaseEnv };
    delete (missingDb as Record<string, unknown>).MONGODB_URI;

    expect(() => validateEnv(missingDb)).toThrowError(/MONGODB_URI/);
  });

  it("should fail fast when JWT secrets are shorter than 16 characters", () => {
    const shortSecretEnv = {
      ...validBaseEnv,
      JWT_ACCESS_SECRET: "too-short",
    };

    expect(() => validateEnv(shortSecretEnv)).toThrowError(
      /JWT_ACCESS_SECRET must be at least 16 characters/
    );
  });

  it("should fail validation when PORT is invalid or out of range", () => {
    const nonNumericPort = { ...validBaseEnv, PORT: "invalid-port" };
    expect(() => validateEnv(nonNumericPort)).toThrowError(/PORT/);

    const outOfRangePortLow = { ...validBaseEnv, PORT: "80" }; // Privileged port < 1024
    expect(() => validateEnv(outOfRangePortLow)).toThrowError(/PORT must be >= 1024/);

    const outOfRangePortHigh = { ...validBaseEnv, PORT: "99999" };
    expect(() => validateEnv(outOfRangePortHigh)).toThrowError(/PORT must be <= 65535/);
  });

  it("should fail validation when NODE_ENV is not an allowed environment", () => {
    const invalidEnv = { ...validBaseEnv, NODE_ENV: "staging" };

    expect(() => validateEnv(invalidEnv)).toThrowError(/NODE_ENV/);
  });

  it("should fail validation when CLIENT_URL is malformed", () => {
    const invalidUrl = { ...validBaseEnv, CLIENT_URL: "not-a-valid-url" };

    expect(() => validateEnv(invalidUrl)).toThrowError(/CLIENT_URL must be a valid URL/);
  });

  it("should fail validation when MONGODB_URI has an invalid protocol scheme", () => {
    const invalidScheme = { ...validBaseEnv, MONGODB_URI: "postgres://localhost:5432/db" };

    expect(() => validateEnv(invalidScheme)).toThrowError(
      /MONGODB_URI must start with mongodb:\/\/ or mongodb\+srv:\/\//
    );
  });

  it("should never leak secret values in validation error messages", () => {
    const rawSecretValue = "UNLEAKABLE_TOKEN_VALUE_XYZ_987";
    const invalidEnvWithSecret = {
      ...validBaseEnv,
      JWT_ACCESS_SECRET: rawSecretValue.slice(0, 5), // "UNLEA" (too short)
    };

    try {
      validateEnv(invalidEnvWithSecret);
      expect.unreachable("validateEnv should have thrown");
    } catch (error: unknown) {
      const errorMessage = (error as Error).message;
      // The error message must mention the field path
      expect(errorMessage).toContain("JWT_ACCESS_SECRET");
      // The error message must NEVER leak the actual attempted secret value
      expect(errorMessage).not.toContain(rawSecretValue.slice(0, 5));
    }
  });

  it("should support deferred optional integrations without forcing fake values", () => {
    const withOptionalIntegrations = {
      ...validBaseEnv,
      RAZORPAY_KEY_ID: "rzp_test_12345",
      LIVEKIT_URL: "https://telehealth.livekit.cloud",
      EMAIL_FROM: "doctor@lifeline.org",
    };

    const config = validateEnv(withOptionalIntegrations);

    expect(config.RAZORPAY_KEY_ID).toBe("rzp_test_12345");
    expect(config.LIVEKIT_URL).toBe("https://telehealth.livekit.cloud");
    expect(config.EMAIL_FROM).toBe("doctor@lifeline.org");
    expect(config.STORAGE_BUCKET).toBeUndefined();
    expect(config.AI_API_KEY).toBeUndefined();
  });
});
