import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { app as mainApp } from "../src/app.js";
import { env } from "../src/config/index.js";
import {
  helmetMiddleware,
  corsMiddleware,
  globalLimiter,
  authLimiter,
  aiLimiter,
  createRateLimiter,
} from "../src/middlewares/index.js";
import { errorHandler } from "../src/middlewares/error.middleware.js";

describe("Security & Rate Limiting Middlewares (Task 2.2)", () => {
  describe("Helmet Security Headers", () => {
    it("should set X-Content-Type-Options: nosniff on API responses", async () => {
      const res = await request(mainApp).get("/api/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should set essential Helmet security headers", async () => {
      const res = await request(mainApp).get("/api/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["x-dns-prefetch-control"]).toBe("off");
    });
  });

  describe("CORS Protection", () => {
    it("should allow requests from env.CLIENT_URL and return credentials headers", async () => {
      const res = await request(mainApp)
        .get("/api/health")
        .set("Origin", env.CLIENT_URL);

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(env.CLIENT_URL);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should reject requests from unauthorized origins with HTTP 403 and no permissive CORS headers", async () => {
      const res = await request(mainApp)
        .get("/api/health")
        .set("Origin", "https://malicious-attacker.com");

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CORS_FORBIDDEN");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should not use wildcard * for CORS origin header", async () => {
      const resAllowed = await request(mainApp)
        .get("/api/health")
        .set("Origin", env.CLIENT_URL);

      expect(resAllowed.headers["access-control-allow-origin"]).not.toBe("*");

      const resDisallowed = await request(mainApp)
        .get("/api/health")
        .set("Origin", "https://unauthorized-domain.org");

      expect(resDisallowed.headers["access-control-allow-origin"]).not.toBe("*");
    });
  });

  describe("RateLimit Response Headers", () => {
    it("should include standard RateLimit-* headers on incoming requests", async () => {
      const res = await request(mainApp)
        .get("/api/health")
        .set("x-test-client-ip", "10.99.1.1");

      expect(res.headers["ratelimit-limit"]).toBe("100");
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
      expect(res.headers["ratelimit-reset"]).toBeDefined();
    });
  });

  describe("Global Rate Limiter (100 req/min)", () => {
    it("should return HTTP 429 with RATE_LIMIT_EXCEEDED when threshold is exceeded", async () => {
      const testIp = "10.99.2.1";

      // Fire 100 requests to exhaust quota
      for (let i = 0; i < 100; i++) {
        await request(mainApp)
          .get("/api/health")
          .set("x-test-client-ip", testIp);
      }

      // 101st request should be rejected with 429 Too Many Requests
      const blockedRes = await request(mainApp)
        .get("/api/health")
        .set("x-test-client-ip", testIp);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(blockedRes.body.error.message).toBe("Too many requests, please try again later");
      expect(blockedRes.body.error.timestamp).toBeDefined();
      expect(blockedRes.headers["ratelimit-remaining"]).toBe("0");
    });
  });

  describe("Tiered Rate Limiters: Auth and AI Limiters", () => {
    it("authLimiter should enforce 5 requests per 15 minutes threshold", async () => {
      const testAuthApp = express();
      testAuthApp.use(authLimiter);
      testAuthApp.get("/auth/login", (_req: Request, res: Response) => {
        res.json({ success: true, message: "login endpoint" });
      });
      testAuthApp.use(errorHandler);

      const testIp = "10.99.3.1";

      // Send 5 permitted attempts
      for (let i = 0; i < 5; i++) {
        const okRes = await request(testAuthApp)
          .get("/auth/login")
          .set("x-test-client-ip", testIp);
        expect(okRes.status).toBe(200);
      }

      // 6th attempt should trigger 429
      const blockedRes = await request(testAuthApp)
        .get("/auth/login")
        .set("x-test-client-ip", testIp);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(blockedRes.body.error.message).toContain("15 minutes");
    });

    it("aiLimiter should enforce 10 requests per minute threshold", async () => {
      const testAiApp = express();
      testAiApp.use(aiLimiter);
      testAiApp.get("/ai/chat", (_req: Request, res: Response) => {
        res.json({ success: true, message: "ai response" });
      });
      testAiApp.use(errorHandler);

      const testIp = "10.99.4.1";

      // Send 10 permitted queries
      for (let i = 0; i < 10; i++) {
        const okRes = await request(testAiApp)
          .get("/ai/chat")
          .set("x-test-client-ip", testIp);
        expect(okRes.status).toBe(200);
      }

      // 11th query should trigger 429
      const blockedRes = await request(testAiApp)
        .get("/ai/chat")
        .set("x-test-client-ip", testIp);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe("AI_RATE_LIMIT_EXCEEDED");
    });

    it("createRateLimiter factory should create isolated custom limiters", () => {
      const customLimiter = createRateLimiter({
        windowMs: 5000,
        limit: 3,
        code: "CUSTOM_RATE_LIMIT",
        message: "Custom limit reached",
      });

      expect(typeof customLimiter).toBe("function");
    });
  });

  describe("Integration with Error Pipeline and Route Handling", () => {
    it("should preserve 404 handling under security middlewares", async () => {
      const res = await request(mainApp).get("/api/v1/non-existent-route");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("should maintain /api/health operational response under security middlewares", async () => {
      const res = await request(mainApp).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("operational");
    });
  });
});
