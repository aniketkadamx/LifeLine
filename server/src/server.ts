import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { app } from "./app.js";
import { env, connectDatabase, disconnectDatabase } from "./config/index.js";
import { startAllJobs, stopAllJobs } from "./jobs/index.js";

const server = http.createServer(app);

// Attach Socket.IO for real-time architecture baseline
export const io = new SocketIOServer(server, {
  cors: {
    origin: env.CLIENT_URL,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  // Real-time connection handler ready for domain events
  socket.on("disconnect", () => {
    // Socket cleanup
  });
});

/**
 * Graceful application termination.
 * Closes background jobs, HTTP server, Socket.IO connections, and the MongoDB connection pool.
 */
export async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Server] Received ${signal}. Commencing graceful shutdown...`);

  // Stop background jobs
  stopAllJobs();

  // Close Socket.IO
  io.close(() => {
    console.log("[Socket.IO] Closed all active socket connections");
  });

  // Close HTTP Server
  server.close(async () => {
    console.log("[HTTP] Server stopped accepting incoming requests");
    try {
      await disconnectDatabase();
      console.log("[Server] Graceful shutdown completed cleanly");
      process.exit(0);
    } catch (err: unknown) {
      console.error("[Server] Error during database disconnect on shutdown:", err);
      process.exit(1);
    }
  });

  // Force shutdown if cleanup hangs > 10s
  setTimeout(() => {
    console.error("[Server] Graceful shutdown timed out after 10s. Forcing exit.");
    process.exit(1);
  }, 10000).unref();
}

/**
 * Boots the application:
 * 1. Establishes MongoDB connection
 * 2. Starts background maintenance jobs
 * 3. Starts HTTP & WebSocket server
 */
export async function startServer(): Promise<http.Server> {
  try {
    // Establish database connection before accepting traffic
    await connectDatabase();

    // Start background maintenance jobs
    startAllJobs();

    return new Promise((resolve) => {
      server.listen(env.PORT, () => {
        console.log(`[LifeLine Server] Running on http://localhost:${env.PORT}`);
        console.log(`[LifeLine Server] Health check: http://localhost:${env.PORT}/api/health`);
        resolve(server);
      });
    });
  } catch (error: unknown) {
    console.error("[Server] Fatal bootstrap error:", error);
    process.exit(1);
  }
}

// Attach process termination signal listeners
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Auto-start server when executed directly (not in test runner)
if (env.NODE_ENV !== "test") {
  startServer();
}

export { server };
