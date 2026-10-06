import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import {
  connectDatabase,
  disconnectDatabase,
  getDatabaseState,
  defaultConnectionOptions,
} from "../src/config/database.js";
import { env } from "../src/config/env.js";

describe("MongoDB Connection Lifecycle (Task 1.1)", () => {
  afterEach(async () => {
    // Ensure clean teardown after each test
    await disconnectDatabase();
  });

  it("should configure production-safe connection pool and timeout defaults", () => {
    expect(defaultConnectionOptions.maxPoolSize).toBe(10);
    expect(defaultConnectionOptions.minPoolSize).toBe(2);
    expect(defaultConnectionOptions.serverSelectionTimeoutMS).toBe(5000);
    expect(defaultConnectionOptions.socketTimeoutMS).toBe(45000);
    expect(defaultConnectionOptions.heartbeatFrequencyMS).toBe(10000);
  });

  it("should correctly report database readiness status", () => {
    const state = getDatabaseState();
    expect(state).toHaveProperty("readyState");
    expect(state).toHaveProperty("status");
    expect(state).toHaveProperty("isConnected");
    expect(typeof state.isConnected).toBe("boolean");
  });

  it("should safely execute disconnectDatabase even when already disconnected", async () => {
    expect(mongoose.connection.readyState).toBe(0); // disconnected
    await expect(disconnectDatabase()).resolves.toBeUndefined();
    expect(getDatabaseState().status).toBe("disconnected");
  });

  it("should fail fast and throw an informative error when connecting to an unreachable host", async () => {
    const unreachableUri = "mongodb://127.0.0.1:27019/unreachable_db"; // Unused port
    const fastFailOptions = {
      ...defaultConnectionOptions,
      serverSelectionTimeoutMS: 500, // Short timeout for unit test
    };

    await expect(
      connectDatabase(unreachableUri, fastFailOptions)
    ).rejects.toThrow(/Failed to connect to MongoDB/);

    expect(getDatabaseState().isConnected).toBe(false);
  });

  it("should confirm the default URI is aligned with validated env.MONGODB_URI", () => {
    expect(env.MONGODB_URI).toBeDefined();
    expect(env.MONGODB_URI.startsWith("mongodb://") || env.MONGODB_URI.startsWith("mongodb+srv://")).toBe(true);
  });
});
