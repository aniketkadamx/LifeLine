import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "./env.js";

/**
 * Production-safe connection options for Mongoose / MongoDB.
 *
 * Rationale for settings:
 * - maxPoolSize (10): Supports concurrent requests while avoiding connection limits on typical MongoDB Atlas tiers.
 * - minPoolSize (2): Keeps warm connections alive to eliminate socket handshake latency on initial queries.
 * - serverSelectionTimeoutMS (5000): Fails fast within 5 seconds if database is unreachable, preventing application freeze.
 * - socketTimeoutMS (45000): Closes inactive sockets after 45 seconds while allowing legitimate longer aggregations.
 * - heartbeatFrequencyMS (10000): Checks replica set health every 10 seconds.
 */
export const defaultConnectionOptions: ConnectOptions = {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 10000,
};

// Global Mongoose event listeners
mongoose.connection.on("connected", () => {
  console.log("[MongoDB] Connection established successfully");
});

mongoose.connection.on("error", (err: Error) => {
  console.error(`[MongoDB] Connection error: ${err.message}`);
});

mongoose.connection.on("disconnected", () => {
  console.warn("[MongoDB] Connection lost / disconnected");
});

mongoose.connection.on("reconnected", () => {
  console.log("[MongoDB] Connection re-established");
});

/**
 * Establishes connection to the MongoDB instance.
 *
 * @param uri - Target MongoDB URI (defaults to validated env.MONGODB_URI)
 * @param options - Mongoose connection options
 * @returns Mongoose instance
 * @throws Error if initial connection fails
 */
export async function connectDatabase(
  uri: string = env.MONGODB_URI,
  options: ConnectOptions = defaultConnectionOptions
): Promise<typeof mongoose> {
  // If already connected, return existing instance
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(uri, options);
    return conn;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Unknown database connection error";
    console.error(`[MongoDB] Initial connection failure: ${errorMsg}`);
    throw new Error(`Failed to connect to MongoDB: ${errorMsg}`);
  }
}

/**
 * Gracefully closes the MongoDB connection.
 * Used during server shutdown and automated test teardown.
 */
export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    console.log("[MongoDB] Connection closed gracefully");
  }
}

/**
 * Returns current database connection state metadata.
 */
export function getDatabaseState(): {
  readyState: number;
  status: "disconnected" | "connected" | "connecting" | "disconnecting";
  isConnected: boolean;
} {
  const stateMap: Record<number, "disconnected" | "connected" | "connecting" | "disconnecting"> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const readyState = mongoose.connection.readyState;
  return {
    readyState,
    status: stateMap[readyState] || "disconnected",
    isConnected: readyState === 1,
  };
}
