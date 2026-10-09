import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import mongoose from "mongoose";
import { UserRole } from "../src/types/models.js";
import { AppError } from "../src/utils/api-error.js";
import { sendSuccess } from "../src/utils/api-response.js";
import { errorHandler, notFoundHandler } from "../src/middlewares/error.middleware.js";
import { authenticate } from "../src/middlewares/auth.middleware.js";
import { authorizeRole } from "../src/middlewares/role.middleware.js";
import { authorizeOwnership } from "../src/middlewares/ownership.middleware.js";
import { tokenService } from "../src/services/token.service.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { Appointment } from "../src/models/appointment.model.js";

describe("Milestone 4 - Task 4.1: RBAC & Resource Ownership Middleware", () => {
  let app: express.Express;

  // In-memory mock resource store for testing ownership finder functions
  const mockAppointments = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_rbac_ownership_test");
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    mockAppointments.clear();
    if (mongoose.connection.readyState === 1) {
      await Appointment.deleteMany({});
    }

    // Build Express test application with routes demonstrating role and ownership middlewares
    app = express();
    app.use(express.json());

    // 1. Doctor-only route
    app.get(
      "/api/v1/test/doctor-only",
      authenticate,
      authorizeRole(UserRole.DOCTOR),
      (_req: Request, res: Response) => {
        sendSuccess(res, { access: "granted", role: "DOCTOR" });
      }
    );

    // 2. Doctor and Admin route (multi-role)
    app.get(
      "/api/v1/test/doctor-or-admin",
      authenticate,
      authorizeRole(UserRole.DOCTOR, UserRole.ADMIN),
      (_req: Request, res: Response) => {
        sendSuccess(res, { access: "granted" });
      }
    );

    // 3. Role authorization route without prior authenticate (edge case)
    app.get(
      "/api/v1/test/unauthenticated-role-check",
      authorizeRole(UserRole.DOCTOR),
      (_req: Request, res: Response) => {
        sendSuccess(res, { access: "granted" });
      }
    );

    // 4. Single-owner route via function finder (Patient owner of appointment)
    app.get(
      "/api/v1/test/appointments/:id",
      authenticate,
      authorizeOwnership(
        (req) => mockAppointments.get(req.params.id) ?? null,
        "patientId"
      ),
      (req: Request, res: Response) => {
        sendSuccess(res, req.resource);
      }
    );

    // 5. Multi-owner route (either Patient or Doctor can own consultation)
    app.get(
      "/api/v1/test/consultations/:id",
      authenticate,
      authorizeOwnership(
        (req) => mockAppointments.get(req.params.id) ?? null,
        ["patientId", "doctorId"]
      ),
      (req: Request, res: Response) => {
        sendSuccess(res, req.resource);
      }
    );

    // 6. Custom predicate ownership route
    app.get(
      "/api/v1/test/custom-predicate/:id",
      authenticate,
      authorizeOwnership(
        (req) => mockAppointments.get(req.params.id) ?? null,
        (resource, user) => resource.createdBy === user.id
      ),
      (req: Request, res: Response) => {
        sendSuccess(res, req.resource);
      }
    );

    // 7. Failing finder route (simulates database lookup failure)
    app.get(
      "/api/v1/test/failing-lookup/:id",
      authenticate,
      authorizeOwnership(
        () => {
          throw new Error("Simulated database failure during resource lookup");
        },
        "patientId"
      ),
      (req: Request, res: Response) => {
        sendSuccess(res, req.resource);
      }
    );

    // 8. Mongoose Model finder route
    app.get(
      "/api/v1/test/db/appointments/:id",
      authenticate,
      authorizeOwnership(Appointment, "patientId"),
      (req: Request, res: Response) => {
        sendSuccess(res, req.resource);
      }
    );

    // Mount 404 and centralized error handlers
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  // =========================================================================
  // Part 1: Role Authorization Tests (`authorizeRole`)
  // =========================================================================
  describe("Role Authorization (`authorizeRole`)", () => {
    it("1. An authenticated patient attempting to access a doctor-only route is rejected with HTTP 403", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);

      const res = await request(app)
        .get("/api/v1/test/doctor-only")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
      expect(res.body.error.message).toContain("insufficient permissions");
    });

    it("2. An authenticated doctor accessing a doctor-only route is allowed to continue (HTTP 200)", async () => {
      const doctorId = new mongoose.Types.ObjectId().toString();
      const doctorToken = tokenService.generateAccessToken(doctorId, UserRole.DOCTOR);

      const res = await request(app)
        .get("/api/v1/test/doctor-only")
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe("DOCTOR");
    });

    it("3. A role outside the explicitly allowed roles is rejected with HTTP 403", async () => {
      const pharmacyId = new mongoose.Types.ObjectId().toString();
      const pharmacyToken = tokenService.generateAccessToken(pharmacyId, UserRole.PHARMACY);

      // Accessing doctor-only route
      const res = await request(app)
        .get("/api/v1/test/doctor-only")
        .set("Authorization", `Bearer ${pharmacyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("4. Multi-role authorization permits any explicitly allowed role", async () => {
      const doctorId = new mongoose.Types.ObjectId().toString();
      const adminId = new mongoose.Types.ObjectId().toString();
      const patientId = new mongoose.Types.ObjectId().toString();

      const doctorToken = tokenService.generateAccessToken(doctorId, UserRole.DOCTOR);
      const adminToken = tokenService.generateAccessToken(adminId, UserRole.ADMIN);
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);

      // Doctor is allowed
      const resDoc = await request(app)
        .get("/api/v1/test/doctor-or-admin")
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(resDoc.status).toBe(200);
      expect(resDoc.body.success).toBe(true);

      // Admin is allowed
      const resAdmin = await request(app)
        .get("/api/v1/test/doctor-or-admin")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.success).toBe(true);

      // Patient is forbidden
      const resPatient = await request(app)
        .get("/api/v1/test/doctor-or-admin")
        .set("Authorization", `Bearer ${patientToken}`);
      expect(resPatient.status).toBe(403);
      expect(resPatient.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("5. Missing authentication is handled safely according to the authentication pipeline (HTTP 401)", async () => {
      const res = await request(app).get("/api/v1/test/doctor-only");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("6. authorizeRole handles missing req.user gracefully when invoked without authenticate middleware", async () => {
      const res = await request(app).get("/api/v1/test/unauthenticated-role-check");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("7. Errors use the project's standardized response format", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);

      const res = await request(app)
        .get("/api/v1/test/doctor-only")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: "AUTH_INSUFFICIENT_PERMISSIONS",
          message: expect.any(String),
          timestamp: expect.any(String),
        },
      });
    });
  });

  // =========================================================================
  // Part 2: Ownership Authorization Tests (`authorizeOwnership`)
  // =========================================================================
  describe("Resource Ownership Authorization (`authorizeOwnership`)", () => {
    it("8. The authenticated resource owner is allowed to continue (HTTP 200)", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);
      const appointmentId = "apt_1001";

      mockAppointments.set(appointmentId, {
        id: appointmentId,
        patientId,
        service: "Cardiology Consultation",
      });

      const res = await request(app)
        .get(`/api/v1/test/appointments/${appointmentId}`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(appointmentId);
      expect(res.body.data.patientId).toBe(patientId);
    });

    it("9. A different authenticated user is denied access with HTTP 403 (AUTH_RESOURCE_ACCESS_DENIED)", async () => {
      const ownerPatientId = new mongoose.Types.ObjectId().toString();
      const attackerPatientId = new mongoose.Types.ObjectId().toString();
      const attackerToken = tokenService.generateAccessToken(attackerPatientId, UserRole.PATIENT);
      const appointmentId = "apt_1002";

      mockAppointments.set(appointmentId, {
        id: appointmentId,
        patientId: ownerPatientId,
        service: "General Checkup",
      });

      const res = await request(app)
        .get(`/api/v1/test/appointments/${appointmentId}`)
        .set("Authorization", `Bearer ${attackerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
      expect(res.body.error.message).toContain("ownership");
    });

    it("10. A client cannot obtain access by supplying another user's ID in body, params, or query", async () => {
      const ownerPatientId = new mongoose.Types.ObjectId().toString();
      const attackerPatientId = new mongoose.Types.ObjectId().toString();
      const attackerToken = tokenService.generateAccessToken(attackerPatientId, UserRole.PATIENT);
      const appointmentId = "apt_1003";

      mockAppointments.set(appointmentId, {
        id: appointmentId,
        patientId: ownerPatientId,
        service: "Orthopedics",
      });

      // Attacker tries to impersonate owner via query parameter and request body
      const res = await request(app)
        .get(`/api/v1/test/appointments/${appointmentId}?patientId=${ownerPatientId}&userId=${ownerPatientId}`)
        .set("Authorization", `Bearer ${attackerToken}`)
        .send({ patientId: ownerPatientId, userId: ownerPatientId });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("11. Missing resources are handled according to the documented error policy (HTTP 404 NOT_FOUND)", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);

      const res = await request(app)
        .get("/api/v1/test/appointments/non_existent_appointment_id")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("12. Missing or invalid ownership data is handled safely (HTTP 403 AUTH_RESOURCE_ACCESS_DENIED)", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);
      const corruptAppointmentId = "apt_corrupt";

      // Resource exists in store but has null or missing patientId
      mockAppointments.set(corruptAppointmentId, {
        id: corruptAppointmentId,
        patientId: null,
      });

      const res = await request(app)
        .get(`/api/v1/test/appointments/${corruptAppointmentId}`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("13. Resource lookup errors reach the existing error-handling pipeline correctly (HTTP 500)", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);

      const res = await request(app)
        .get("/api/v1/test/failing-lookup/apt_fail")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("14. Multi-owner field allows either authorized participant (Patient or Doctor)", async () => {
      const patientId = new mongoose.Types.ObjectId().toString();
      const doctorId = new mongoose.Types.ObjectId().toString();
      const unrelatedUserId = new mongoose.Types.ObjectId().toString();

      const patientToken = tokenService.generateAccessToken(patientId, UserRole.PATIENT);
      const doctorToken = tokenService.generateAccessToken(doctorId, UserRole.DOCTOR);
      const unrelatedToken = tokenService.generateAccessToken(unrelatedUserId, UserRole.PHARMACY);

      const consultationId = "cons_501";
      mockAppointments.set(consultationId, {
        id: consultationId,
        patientId,
        doctorId,
      });

      // 1. Patient has access
      const resPatient = await request(app)
        .get(`/api/v1/test/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(resPatient.status).toBe(200);
      expect(resPatient.body.success).toBe(true);

      // 2. Doctor has access
      const resDoctor = await request(app)
        .get(`/api/v1/test/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(resDoctor.status).toBe(200);
      expect(resDoctor.body.success).toBe(true);

      // 3. Unrelated user is denied
      const resUnrelated = await request(app)
        .get(`/api/v1/test/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${unrelatedToken}`);
      expect(resUnrelated.status).toBe(403);
      expect(resUnrelated.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("15. Custom predicate evaluates ownership correctly", async () => {
      const creatorId = new mongoose.Types.ObjectId().toString();
      const nonCreatorId = new mongoose.Types.ObjectId().toString();

      const creatorToken = tokenService.generateAccessToken(creatorId, UserRole.PATIENT);
      const nonCreatorToken = tokenService.generateAccessToken(nonCreatorId, UserRole.PATIENT);

      const resourceId = "pred_1";
      mockAppointments.set(resourceId, {
        id: resourceId,
        createdBy: creatorId,
      });

      // Creator is allowed
      const resAllowed = await request(app)
        .get(`/api/v1/test/custom-predicate/${resourceId}`)
        .set("Authorization", `Bearer ${creatorToken}`);
      expect(resAllowed.status).toBe(200);

      // Non-creator is forbidden
      const resForbidden = await request(app)
        .get(`/api/v1/test/custom-predicate/${resourceId}`)
        .set("Authorization", `Bearer ${nonCreatorToken}`);
      expect(resForbidden.status).toBe(403);
      expect(resForbidden.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("16. Works seamlessly with real MongoDB Mongoose documents", async () => {
      const patientId = new mongoose.Types.ObjectId();
      const doctorId = new mongoose.Types.ObjectId();
      const otherPatientId = new mongoose.Types.ObjectId();

      const patientToken = tokenService.generateAccessToken(patientId.toString(), UserRole.PATIENT);
      const otherToken = tokenService.generateAccessToken(otherPatientId.toString(), UserRole.PATIENT);

      // Create an actual appointment document in MongoDB
      const appointment = await Appointment.create({
        patientId,
        doctorId,
        scheduledStart: new Date(Date.now() + 86400000),
        scheduledEnd: new Date(Date.now() + 86400000 + 1800000),
        appointmentType: "VIDEO",
        reason: "Routine Follow-up",
        fee: 500,
      });

      // 1. Owner patient fetches their appointment via Mongoose Model finder
      const resOwner = await request(app)
        .get(`/api/v1/test/db/appointments/${appointment._id}`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(resOwner.status).toBe(200);
      expect(resOwner.body.success).toBe(true);
      expect(resOwner.body.data.id).toBe(appointment._id.toString());

      // 2. Different user is rejected
      const resOther = await request(app)
        .get(`/api/v1/test/db/appointments/${appointment._id}`)
        .set("Authorization", `Bearer ${otherToken}`);

      expect(resOther.status).toBe(403);
      expect(resOther.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");

      // 3. Non-existent ID returns 404
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const resMissing = await request(app)
        .get(`/api/v1/test/db/appointments/${nonExistentId}`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(resMissing.status).toBe(404);
      expect(resMissing.body.error.code).toBe("NOT_FOUND");
    });
  });
});
