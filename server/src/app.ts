import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env, getDatabaseState } from "./config/index.js";
import { sendSuccess } from "./utils/index.js";
import { notFoundHandler, errorHandler } from "./middlewares/index.js";

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

