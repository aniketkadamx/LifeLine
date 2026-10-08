import express, { type Express, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { getDatabaseState } from "./config/index.js";
import { sendSuccess } from "./utils/index.js";
import {
  helmetMiddleware,
  corsMiddleware,
  globalLimiter,
  notFoundHandler,
  errorHandler,
} from "./middlewares/index.js";

export const app: Express = express();

// Security Headers (Earliest in pipeline)
app.use(helmetMiddleware);

// Cross-Origin Resource Sharing (CORS)
app.use(corsMiddleware);

// Global API Rate Limiter (100 req/min)
app.use(globalLimiter);

// Request Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Base Health Check Endpoint (System Verification)
app.get("/api/health", (_req: Request, res: Response) => {
  const dbState = getDatabaseState();
  sendSuccess(
    res,
    {
      status: "operational",
      service: "LifeLine API",
      database: dbState.status,
      timestamp: new Date().toISOString(),
    },
    "LifeLine backend service is running"
  );
});

// 404 Handler
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

