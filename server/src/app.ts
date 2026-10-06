import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/index.js";

export const app: Express = express();

// Core Middleware
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Base Health Check Endpoint (System Verification)
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      status: "operational",
      service: "LifeLine API",
      timestamp: new Date().toISOString(),
    },
    message: "LifeLine backend service is running",
  });
});

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "The requested endpoint does not exist",
    },
  });
});

// Centralized Error Handling Middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isDev = env.NODE_ENV !== "production";
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: isDev ? err.message : "An unexpected server error occurred",
    },
  });
});
