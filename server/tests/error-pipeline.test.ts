import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { z } from "zod";
import mongoose from "mongoose";
import {
  sendSuccess,
  sendPaginated,
  AppError,
  type ApiResponseSuccess,
  type ApiResponseError,
} from "../src/utils/index.js";
import { errorHandler, notFoundHandler } from "../src/middlewares/index.js";
import { app as mainApp } from "../src/app.js";

describe("Centralized Error Handling & Response Envelope Pipeline (Task 2.1)", () => {
  describe("API Response Helpers (sendSuccess & sendPaginated)", () => {
    it("sendSuccess should send a standard success response envelope with default 200 status", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      const data = { userId: "usr_123", email: "test@lifeline.org" };
      sendSuccess(res, data);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data,
      });
    });

    it("sendSuccess should include custom status, message, and meta when supplied", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      const data = { appointmentId: "apt_999" };
      sendSuccess(
        res,
        data,
        "Appointment booked successfully",
        201,
        { timestamp: "2026-10-08T12:00:00.000Z" }
      );

      expect(mockStatus).toHaveBeenCalledWith(201);
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data,
        message: "Appointment booked successfully",
        meta: { timestamp: "2026-10-08T12:00:00.000Z" },
      });
    });

    it("sendPaginated should calculate pagination metadata correctly for page 1 of 3", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      const items = [{ id: "1" }, { id: "2" }];
      sendPaginated(res, items, { page: 1, limit: 10, total: 25 });

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalled();

      const payload = mockJson.mock.calls[0][0] as ApiResponseSuccess<typeof items>;
      expect(payload.success).toBe(true);
      expect(payload.data).toEqual(items);
      expect(payload.meta).toBeDefined();
      expect(payload.meta?.page).toBe(1);
      expect(payload.meta?.limit).toBe(10);
      expect(payload.meta?.total).toBe(25);
      expect(payload.meta?.totalPages).toBe(3);
      expect(payload.meta?.hasNextPage).toBe(true);
      expect(payload.meta?.hasPrevPage).toBe(false);
      expect(payload.meta?.timestamp).toBeDefined();
    });

    it("sendPaginated should calculate pagination metadata for middle and final pages", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      // Page 2 of 3
      sendPaginated(res, [], { page: 2, limit: 10, total: 25 });
      let payload = mockJson.mock.calls[0][0] as ApiResponseSuccess<unknown[]>;
      expect(payload.meta?.hasNextPage).toBe(true);
      expect(payload.meta?.hasPrevPage).toBe(true);

      // Page 3 of 3 (final page)
      mockJson.mockClear();
      sendPaginated(res, [], { page: 3, limit: 10, total: 25 });
      payload = mockJson.mock.calls[0][0] as ApiResponseSuccess<unknown[]>;
      expect(payload.meta?.hasNextPage).toBe(false);
      expect(payload.meta?.hasPrevPage).toBe(true);
    });

    it("sendPaginated should support optional sort and order parameters in meta", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      sendPaginated(
        res,
        [],
        { page: 1, limit: 20, total: 5, sort: "createdAt", order: "desc" },
        "Fetched list"
      );

      const payload = mockJson.mock.calls[0][0] as ApiResponseSuccess<unknown[]>;
      expect(payload.message).toBe("Fetched list");
      expect(payload.meta?.sort).toBe("createdAt");
      expect(payload.meta?.order).toBe("desc");
      expect(payload.meta?.totalPages).toBe(1);
    });

    it("sendPaginated should handle zero total items gracefully", () => {
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const res = { status: mockStatus } as unknown as Response;

      sendPaginated(res, [], { page: 1, limit: 20, total: 0 });

      const payload = mockJson.mock.calls[0][0] as ApiResponseSuccess<unknown[]>;
      expect(payload.meta?.total).toBe(0);
      expect(payload.meta?.totalPages).toBe(0);
      expect(payload.meta?.hasNextPage).toBe(false);
      expect(payload.meta?.hasPrevPage).toBe(false);
    });
  });

  describe("AppError Domain Exception Class", () => {
    it("should instantiate an AppError with custom properties", () => {
      const error = new AppError(
        403,
        "AUTH_ACCOUNT_SUSPENDED",
        "Your account is suspended",
        [{ field: "status", issue: "Account suspended by administrator" }]
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("AUTH_ACCOUNT_SUSPENDED");
      expect(error.message).toBe("Your account is suspended");
      expect(error.details).toHaveLength(1);
      expect(error.isOperational).toBe(true);
      expect(error.stack).toBeDefined();
    });

    it("should expose convenient static factory helpers for standard HTTP statuses", () => {
      const badReq = AppError.badRequest("Invalid query", "QUERY_INVALID");
      expect(badReq.statusCode).toBe(400);
      expect(badReq.code).toBe("QUERY_INVALID");

      const unauth = AppError.unauthorized();
      expect(unauth.statusCode).toBe(401);
      expect(unauth.code).toBe("AUTH_TOKEN_MISSING");

      const forbidden = AppError.forbidden();
      expect(forbidden.statusCode).toBe(403);

      const notFound = AppError.notFound();
      expect(notFound.statusCode).toBe(404);
      expect(notFound.code).toBe("NOT_FOUND");

      const conflict = AppError.conflict("Slot already reserved", "APPOINTMENT_SLOT_UNAVAILABLE");
      expect(conflict.statusCode).toBe(409);
      expect(conflict.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");

      const unproc = AppError.unprocessable();
      expect(unproc.statusCode).toBe(422);
      expect(unproc.code).toBe("VALIDATION_ERROR");

      const internal = AppError.internal();
      expect(internal.statusCode).toBe(500);
      expect(internal.code).toBe("INTERNAL_SERVER_ERROR");
      expect(internal.isOperational).toBe(false);
    });
  });

  describe("Centralized Error Middleware Pipeline Integration", () => {
    let testApp: express.Express;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      testApp = express();
      testApp.use(express.json());

      // Test route for Zod validation error
      testApp.post("/test/zod", (req: Request, _res: Response) => {
        const schema = z.object({
          email: z.string().email("Invalid email address"),
          age: z.number().int().min(18, "Must be at least 18 years old"),
        });
        schema.parse(req.body);
      });

      // Test route for Mongoose duplicate key error (E11000)
      testApp.get("/test/duplicate-key-email", () => {
        const err = new Error("E11000 duplicate key error collection: users index: email_1 dup key") as any;
        err.code = 11000;
        err.keyValue = { email: "taken@lifeline.org" };
        throw err;
      });

      testApp.get("/test/duplicate-key-generic", () => {
        const err = new Error("E11000 duplicate key error") as any;
        err.name = "MongoServerError";
        err.code = 11000;
        err.keyValue = { registrationNumber: "MED_12345" };
        throw err;
      });

      // Test route for Mongoose CastError
      testApp.get("/test/cast-error", () => {
        const castErr = new mongoose.Error.CastError("ObjectId", "invalid-id-xyz", "doctorId");
        throw castErr;
      });

      // Test route for Mongoose ValidationError
      testApp.get("/test/mongoose-validation", () => {
        const validationErr = new mongoose.Error.ValidationError();
        validationErr.addError(
          "specialization",
          new mongoose.Error.ValidatorError({
            message: "Specialization is required",
            path: "specialization",
            type: "required",
          })
        );
        throw validationErr;
      });

      // Test route for AppError
      testApp.get("/test/app-error", () => {
        throw new AppError(
          403,
          "AUTH_INSUFFICIENT_PERMISSIONS",
          "Only verified doctors may access this resource"
        );
      });

      // Test route for unexpected error
      testApp.get("/test/unexpected-error", () => {
        throw new Error("Critical database socket failure: internal connection lost");
      });

      // Unmatched route 404 handler
      testApp.use(notFoundHandler);

      // Centralized error handling middleware
      testApp.use(errorHandler);
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it("1. should map Zod validation errors to HTTP 422 with VALIDATION_ERROR and granular details", async () => {
      const res = await request(testApp)
        .post("/test/zod")
        .send({ email: "invalid-email-format", age: 15 });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toBe("Validation failed for provided fields");
      expect(res.body.error.timestamp).toBeDefined();

      const details = res.body.error.details;
      expect(Array.isArray(details)).toBe(true);
      expect(details).toHaveLength(2);

      const emailIssue = details.find((d: any) => d.field === "email");
      expect(emailIssue).toBeDefined();
      expect(emailIssue.issue).toBe("Invalid email address");

      const ageIssue = details.find((d: any) => d.field === "age");
      expect(ageIssue).toBeDefined();
      expect(ageIssue.issue).toBe("Must be at least 18 years old");
    });

    it("2. should map MongoDB duplicate key errors to HTTP 409 with domain-specific conflict codes", async () => {
      // Email duplicate
      const resEmail = await request(testApp).get("/test/duplicate-key-email");
      expect(resEmail.status).toBe(409);
      expect(resEmail.body.success).toBe(false);
      expect(resEmail.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");
      expect(resEmail.body.error.message).toBe("Provided email address is already in use");
      expect(resEmail.body.error.details).toEqual([
        { field: "email", issue: "Duplicate value for field 'email'" },
      ]);

      // Generic duplicate key
      const resGeneric = await request(testApp).get("/test/duplicate-key-generic");
      expect(resGeneric.status).toBe(409);
      expect(resGeneric.body.success).toBe(false);
      expect(resGeneric.body.error.code).toBe("RESOURCE_CONFLICT");
      expect(resGeneric.body.error.details).toEqual([
        { field: "registrationNumber", issue: "Duplicate value for field 'registrationNumber'" },
      ]);
    });

    it("3. should map Mongoose CastError to HTTP 400 and ValidationError to HTTP 422", async () => {
      const resCast = await request(testApp).get("/test/cast-error");
      expect(resCast.status).toBe(400);
      expect(resCast.body.error.code).toBe("BAD_REQUEST");
      expect(resCast.body.error.message).toContain("doctorId");

      const resVal = await request(testApp).get("/test/mongoose-validation");
      expect(resVal.status).toBe(422);
      expect(resVal.body.error.code).toBe("VALIDATION_ERROR");
      expect(resVal.body.error.details).toEqual([
        { field: "specialization", issue: "Specialization is required" },
      ]);
    });

    it("4. should correctly format domain AppError instances", async () => {
      const res = await request(testApp).get("/test/app-error");

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
      expect(res.body.error.message).toBe("Only verified doctors may access this resource");
      expect(res.body.error.timestamp).toBeDefined();
    });

    it("5. should handle unmatched routes through notFoundHandler with HTTP 404 and ROUTE_NOT_FOUND", async () => {
      const res = await request(testApp).get("/api/unknown/resource/route");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
      expect(res.body.error.message).toBe("The requested endpoint does not exist");
      expect(res.body.error.timestamp).toBeDefined();
    });

    it("6. should correlate requestId when x-request-id header is provided", async () => {
      const res = await request(testApp)
        .get("/test/app-error")
        .set("x-request-id", "req_lifeline_trace_49201");

      expect(res.status).toBe(403);
      expect(res.body.error.requestId).toBe("req_lifeline_trace_49201");
    });

    it("7. should map unexpected errors to HTTP 500 INTERNAL_SERVER_ERROR", async () => {
      const res = await request(testApp).get("/test/unexpected-error");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(res.body.error.timestamp).toBeDefined();
    });

    it("8. PRODUCTION SECURITY: should NOT expose stack traces or raw exception messages in production mode", async () => {
      process.env.NODE_ENV = "production";

      const res = await request(testApp).get("/test/unexpected-error");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      // Must not leak the internal exception message
      expect(res.body.error.message).toBe("An unexpected server error occurred");
      // Must not leak stack trace
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("database socket failure");
      expect(JSON.stringify(res.body)).not.toContain("error-pipeline.test.ts");
    });
  });

  describe("Integration With Main Express Application (app.ts)", () => {
    it("should keep /api/health working with sendSuccess format", async () => {
      const res = await request(mainApp).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("operational");
      expect(res.body.data.service).toBe("LifeLine API");
      expect(res.body.message).toBe("LifeLine backend service is running");
    });

    it("should handle unmatched routes in mainApp through centralized error pipeline", async () => {
      const res = await request(mainApp).get("/api/v1/invalid-route-check");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
      expect(res.body.error.message).toBe("The requested endpoint does not exist");
      expect(res.body.error.timestamp).toBeDefined();
    });
  });
});
