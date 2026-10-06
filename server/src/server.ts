import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { app } from "./app.js";
import { env } from "./config/index.js";

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

server.listen(env.PORT, () => {
  console.log(`[LifeLine Server] Running on http://localhost:${env.PORT}`);
  console.log(`[LifeLine Server] Health check: http://localhost:${env.PORT}/api/health`);
});

export { server };
