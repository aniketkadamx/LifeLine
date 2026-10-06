import http from "node:http";
import dotenv from "dotenv";
import { Server as SocketIOServer } from "socket.io";
import { app } from "./app.js";

dotenv.config();

const PORT = process.env.PORT || 5001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const server = http.createServer(app);

// Attach Socket.IO for real-time architecture baseline
export const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  // Real-time connection handler ready for domain events
  socket.on("disconnect", () => {
    // Socket cleanup
  });
});

server.listen(PORT, () => {
  console.log(`[LifeLine Server] Running on http://localhost:${PORT}`);
  console.log(`[LifeLine Server] Health check: http://localhost:${PORT}/api/health`);
});

export { server };
