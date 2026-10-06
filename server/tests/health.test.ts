import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("GET /api/health", () => {
  it("should return 200 with operational status", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("success", true);
    expect(response.body.data).toHaveProperty("status", "operational");
    expect(response.body.data).toHaveProperty("service", "LifeLine API");
  });

  it("should return 404 for unknown routes", async () => {
    const response = await request(app).get("/api/non-existent-endpoint");
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("success", false);
    expect(response.body.error).toHaveProperty("code", "ROUTE_NOT_FOUND");
  });
});
