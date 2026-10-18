import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  Appointment,
  Review,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  AppointmentStatus,
  ConsultationType,
  ReviewStatus,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { reviewService } from "../src/services/review.service.js";

describe("Milestone 12 - Task 12.1: Post-Consultation Doctor Review & Rating Engine", () => {
  let patientUser: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientToken: string;

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let otherDoctorUser: any;
  let otherDoctorProfile: any;
  let otherDoctorToken: string;

  let pharmacyUser: any;
  let pharmacyToken: string;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_review_system_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Review.syncIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await DoctorProfile.deleteMany({});
    await Appointment.deleteMany({});
    await Review.deleteMany({});

    // 1. Patient User 1
    patientUser = await User.create({
      email: "patient1.review@example.com",
      phone: "+919876541001",
      fullName: "Alice Patient",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      avatar: "https://example.com/avatar/alice.jpg",
    });
    patientToken = tokenService.generateAccessToken(
      patientUser._id.toString(),
      UserRole.PATIENT
    );

    // 2. Patient User 2
    otherPatientUser = await User.create({
      email: "patient2.review@example.com",
      phone: "+919876541002",
      fullName: "Bob Patient",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherPatientToken = tokenService.generateAccessToken(
      otherPatientUser._id.toString(),
      UserRole.PATIENT
    );

    // 3. Doctor User 1 & Profile
    doctorUser = await User.create({
      email: "doctor1.review@example.com",
      phone: "+919876541003",
      fullName: "Dr. Sarah Smith",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "Cardiology",
      qualifications: ["MBBS", "MD Cardiology"],
      experienceYears: 12,
      registrationNumber: "MCI-REV-1001",
      registrationCouncil: "Delhi Medical Council",
      consultationFee: 750,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      rating: 0,
      totalReviews: 0,
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Doctor User 2 & Profile
    otherDoctorUser = await User.create({
      email: "doctor2.review@example.com",
      phone: "+919876541004",
      fullName: "Dr. Robert Jones",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherDoctorProfile = await DoctorProfile.create({
      userId: otherDoctorUser._id,
      specialization: "Neurology",
      qualifications: ["MBBS", "DM Neurology"],
      experienceYears: 15,
      registrationNumber: "MCI-REV-1002",
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 900,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      rating: 0,
      totalReviews: 0,
    });
    otherDoctorToken = tokenService.generateAccessToken(
      otherDoctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 5. Pharmacy User
    pharmacyUser = await User.create({
      email: "pharmacy.review@example.com",
      phone: "+919876541005",
      fullName: "Central Pharmacy Staff",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyToken = tokenService.generateAccessToken(
      pharmacyUser._id.toString(),
      UserRole.PHARMACY
    );
  });

  // Helper to create an appointment
  async function createTestAppointment(
    overrides: Partial<Parameters<typeof Appointment.create>[0]> = {}
  ) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    return Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: startTime,
      scheduledEnd: endTime,
      reason: "Post-consultation follow-up",
      status: AppointmentStatus.COMPLETED,
      fee: 750,
      ...overrides,
    });
  }

  describe("Section A: Eligibility Verification", () => {
    it("A1: Allows an eligible patient to review a completed appointment", async () => {
      const appointment = await createTestAppointment({
        status: AppointmentStatus.COMPLETED,
      });

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
          comment: "Dr. Smith provided exemplary clinical guidance and clear care instructions.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.rating).toBe(5);
      expect(response.body.data.comment).toBe(
        "Dr. Smith provided exemplary clinical guidance and clear care instructions."
      );
      expect(response.body.data.doctorId.toString()).toBe(doctorUser._id.toString());
      expect(response.body.data.patientId.toString()).toBe(patientUser._id.toString());
      expect(response.body.data.appointmentId.toString()).toBe(appointment._id.toString());

      // Verify DB persistence
      const reviewId = response.body.data.id || response.body.data._id;
      const savedReview = await Review.findById(reviewId);
      expect(savedReview).not.toBeNull();
      expect(savedReview?.rating).toBe(5);
    });

    it("A2: Rejects reviews for uncompleted appointments with HTTP 422", async () => {
      const nonCompletedStatuses = [
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.IN_PROGRESS,
        AppointmentStatus.PENDING_PAYMENT,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.REJECTED,
        AppointmentStatus.NO_SHOW,
      ];

      for (const status of nonCompletedStatuses) {
        const appointment = await createTestAppointment({ status });

        const response = await request(app)
          .post("/api/v1/reviews")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            appointmentId: appointment._id.toString(),
            rating: 4,
            comment: "Attempting review on non-completed encounter.",
          });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe("APPOINTMENT_NOT_COMPLETED");
        expect(response.body.error.message).toContain("Only completed appointments qualify");
      }
    });

    it("A3: Prevents a patient from reviewing another patient's appointment with HTTP 403", async () => {
      const appointment = await createTestAppointment({
        patientId: otherPatientUser._id,
        status: AppointmentStatus.COMPLETED,
      });

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 4,
          comment: "Attempting unauthorized review of someone else's appointment.",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("A4: Returns HTTP 404 when the target appointment does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: nonExistentId,
          rating: 4,
          comment: "Reviewing ghost appointment.",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("APPOINTMENT_NOT_FOUND");
    });

    it("A5: Rejects unauthenticated review submissions with HTTP 401", async () => {
      const appointment = await createTestAppointment();

      const response = await request(app)
        .post("/api/v1/reviews")
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("A6: Rejects non-patient roles from submitting reviews with HTTP 403", async () => {
      const appointment = await createTestAppointment();

      // Doctor role
      const docResponse = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
        });
      expect(docResponse.status).toBe(403);
      expect(docResponse.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Pharmacy role
      const pharmResponse = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
        });
      expect(pharmResponse.status).toBe(403);
      expect(pharmResponse.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("A7: Rejects doctor mismatch anti-fraud check if doctorId does not match appointment", async () => {
      const appointment = await createTestAppointment();

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          doctorId: otherDoctorUser._id.toString(), // spoofed doctor ID
          rating: 5,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("DOCTOR_MISMATCH");
    });
  });

  describe("Section B: Duplicate Prevention & Concurrency", () => {
    it("B1: Allows exactly one review per appointment and returns HTTP 409 on second attempt", async () => {
      const appointment = await createTestAppointment();

      // First submission succeeds
      const firstResponse = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
          comment: "Initial great review.",
        });
      expect(firstResponse.status).toBe(201);

      // Second submission for the same appointment is rejected with 409
      const secondResponse = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 4,
          comment: "Duplicate review attempt.",
        });

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body.success).toBe(false);
      expect(secondResponse.body.error.code).toBe("REVIEW_ALREADY_EXISTS");

      // Only one review persisted in DB
      const count = await Review.countDocuments({ appointmentId: appointment._id });
      expect(count).toBe(1);
    });

    it("B2: Concurrency safety prevents duplicate reviews when multiple requests race", async () => {
      const appointment = await createTestAppointment();

      // Fire 5 concurrent review requests for the same appointment
      const promises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post("/api/v1/reviews")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            appointmentId: appointment._id.toString(),
            rating: 4,
            comment: `Concurrent race attempt ${i + 1}`,
          })
      );

      const responses = await Promise.all(promises);

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(4);

      // Ensure exactly 1 review exists in DB
      const count = await Review.countDocuments({ appointmentId: appointment._id });
      expect(count).toBe(1);
    });

    it("B3: Maps MongoDB duplicate-key errors (E11000) directly to HTTP 409", async () => {
      const appointment = await createTestAppointment();

      // Pre-insert a review bypassing service check to force DB E11000 on next insert
      await Review.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentId: appointment._id,
        rating: 5,
        status: ReviewStatus.PUBLISHED,
      });

      // Spy on Review.findOne to simulate race where pre-check passed
      const findOneSpy = vi.spyOn(Review, "findOne").mockResolvedValueOnce(null as any);

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 4,
          comment: "Simulated race collision.",
        });

      findOneSpy.mockRestore();

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("REVIEW_ALREADY_EXISTS");
    });
  });

  describe("Section C: Rating & Input Validation", () => {
    it("C1: Accepts valid integer ratings 1, 2, 3, 4, 5", async () => {
      for (const validRating of [1, 2, 3, 4, 5]) {
        const appointment = await createTestAppointment();

        const response = await request(app)
          .post("/api/v1/reviews")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            appointmentId: appointment._id.toString(),
            rating: validRating,
          });

        expect(response.status).toBe(201);
        expect(response.body.data.rating).toBe(validRating);
      }
    });

    it("C2: Strictly rejects invalid ratings: 0, -1, 6, 2.5, strings, null, and missing", async () => {
      const invalidRatings = [0, -1, 6, 2.5, "5", null, undefined];

      for (const invalidRating of invalidRatings) {
        const appointment = await createTestAppointment();

        const response = await request(app)
          .post("/api/v1/reviews")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            appointmentId: appointment._id.toString(),
            ...(invalidRating !== undefined ? { rating: invalidRating } : {}),
          });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("C3: Rejects comments that exceed 1000 characters", async () => {
      const appointment = await createTestAppointment();
      const longComment = "A".repeat(1001);

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 4,
          comment: longComment,
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("C4: Rejects unknown / prohibited request body fields", async () => {
      const appointment = await createTestAppointment();

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
          aggregateRating: 5.0, // prohibited field
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Section D: Aggregate Rating Calculation", () => {
    it("D1: First review updates doctor profile rating and review count correctly", async () => {
      const appointment = await createTestAppointment();

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
        });

      expect(response.status).toBe(201);

      const updatedProfile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(updatedProfile?.rating).toBe(5);
      expect(updatedProfile?.totalReviews).toBe(1);
    });

    it("D2: Multiple ratings (5, 4, 3) yield correct average 4.0 and count 3", async () => {
      // 3 appointments completed for the same doctor
      const appt1 = await createTestAppointment({ patientId: patientUser._id });
      const appt2 = await createTestAppointment({ patientId: otherPatientUser._id });
      const appt3 = await createTestAppointment({ patientId: patientUser._id });

      // Review 1: Rating 5
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ appointmentId: appt1._id.toString(), rating: 5 });

      let profile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(profile?.rating).toBe(5);
      expect(profile?.totalReviews).toBe(1);

      // Review 2: Rating 4
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${otherPatientToken}`)
        .send({ appointmentId: appt2._id.toString(), rating: 4 });

      profile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(profile?.rating).toBe(4.5);
      expect(profile?.totalReviews).toBe(2);

      // Review 3: Rating 3
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ appointmentId: appt3._id.toString(), rating: 3 });

      profile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(profile?.rating).toBe(4); // (5 + 4 + 3) / 3 = 4.0
      expect(profile?.totalReviews).toBe(3);
    });

    it("D3: Duplicate review rejections do not corrupt the aggregate", async () => {
      const appt1 = await createTestAppointment({ patientId: patientUser._id });

      // Submit valid review
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ appointmentId: appt1._id.toString(), rating: 5 });

      // Attempt duplicate review
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ appointmentId: appt1._id.toString(), rating: 1 });

      const profile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(profile?.rating).toBe(5);
      expect(profile?.totalReviews).toBe(1);
    });

    it("D4: Concurrent reviews for distinct appointments calculate the correct final aggregate", async () => {
      const appt1 = await createTestAppointment({ patientId: patientUser._id });
      const appt2 = await createTestAppointment({ patientId: otherPatientUser._id });
      const appt3 = await createTestAppointment({ patientId: patientUser._id });

      const ratings = [
        { appt: appt1, rating: 5, token: patientToken },
        { appt: appt2, rating: 4, token: otherPatientToken },
        { appt: appt3, rating: 4, token: patientToken },
      ];

      await Promise.all(
        ratings.map((r) =>
          request(app)
            .post("/api/v1/reviews")
            .set("Authorization", `Bearer ${r.token}`)
            .send({ appointmentId: r.appt._id.toString(), rating: r.rating })
        )
      );

      const profile = await DoctorProfile.findOne({ userId: doctorUser._id });
      expect(profile?.totalReviews).toBe(3);
      // (5 + 4 + 4) / 3 = 4.3333... rounded to 4.3
      expect(profile?.rating).toBe(4.3);
    });

    it("D5: Rollback strategy restores consistency if aggregate update fails", async () => {
      const appointment = await createTestAppointment();

      // Spy on updateDoctorAggregateRating to simulate DB failure
      const aggregateSpy = vi
        .spyOn(reviewService, "updateDoctorAggregateRating")
        .mockRejectedValueOnce(new Error("Simulated DoctorProfile update database timeout"));

      const response = await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appointment._id.toString(),
          rating: 5,
        });

      aggregateSpy.mockRestore();

      expect(response.status).toBe(500);

      // Verify compensating rollback: the review was deleted, preventing orphaned state
      const reviewExists = await Review.findOne({ appointmentId: appointment._id });
      expect(reviewExists).toBeNull();
    });
  });

  describe("Section E: Public Review Retrieval", () => {
    it("E1: Retrieves public reviews for a doctor with aggregate rating", async () => {
      const appt1 = await createTestAppointment({ patientId: patientUser._id });
      const appt2 = await createTestAppointment({ patientId: otherPatientUser._id });

      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appt1._id.toString(),
          rating: 5,
          comment: "Outstanding consultation, very reassuring.",
        });

      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${otherPatientToken}`)
        .send({
          appointmentId: appt2._id.toString(),
          rating: 4,
          comment: "Thorough examination and prompt diagnosis.",
        });

      // Retrieve via Doctor User._id
      const res = await request(app).get(
        `/api/v1/reviews/doctors/${doctorUser._id.toString()}`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Check deterministic ordering: newest first
      expect(res.body.data[0].comment).toBe("Thorough examination and prompt diagnosis.");
      expect(res.body.data[1].comment).toBe("Outstanding consultation, very reassuring.");

      // Check pagination and aggregate metadata
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.doctor).toBeDefined();
      expect(res.body.meta.doctor.rating).toBe(4.5);
      expect(res.body.meta.doctor.totalReviews).toBe(2);
    });

    it("E2: Supports lookup by DoctorProfile._id seamlessly", async () => {
      const appt = await createTestAppointment();
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ appointmentId: appt._id.toString(), rating: 5 });

      // Retrieve via DoctorProfile._id
      const res = await request(app).get(
        `/api/v1/reviews/doctors/${doctorProfile._id.toString()}`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.doctor.rating).toBe(5);
    });

    it("E3: Filters reviews strictly by the requested doctor", async () => {
      const doc1Appt = await createTestAppointment({ doctorId: doctorUser._id });
      const doc2Appt = await createTestAppointment({ doctorId: otherDoctorUser._id });

      // Review for Doctor 1
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: doc1Appt._id.toString(),
          rating: 5,
          comment: "Review exclusively for Doctor 1",
        });

      // Review for Doctor 2
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: doc2Appt._id.toString(),
          rating: 3,
          comment: "Review exclusively for Doctor 2",
        });

      // Fetch Doctor 1's reviews
      const res1 = await request(app).get(
        `/api/v1/reviews/doctors/${doctorUser._id.toString()}`
      );
      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(1);
      expect(res1.body.data[0].comment).toBe("Review exclusively for Doctor 1");

      // Fetch Doctor 2's reviews
      const res2 = await request(app).get(
        `/api/v1/reviews/doctors/${otherDoctorUser._id.toString()}`
      );
      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(1);
      expect(res2.body.data[0].comment).toBe("Review exclusively for Doctor 2");
    });

    it("E4: Respects bounded pagination parameters", async () => {
      // Create 3 reviews
      for (let i = 1; i <= 3; i++) {
        const appt = await createTestAppointment();
        await request(app)
          .post("/api/v1/reviews")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            appointmentId: appt._id.toString(),
            rating: 4,
            comment: `Pagination item ${i}`,
          });
      }

      // Page 1 with limit 2
      const page1Res = await request(app).get(
        `/api/v1/reviews/doctors/${doctorUser._id.toString()}?page=1&limit=2`
      );
      expect(page1Res.status).toBe(200);
      expect(page1Res.body.data).toHaveLength(2);
      expect(page1Res.body.meta.page).toBe(1);
      expect(page1Res.body.meta.limit).toBe(2);
      expect(page1Res.body.meta.total).toBe(3);
      expect(page1Res.body.meta.totalPages).toBe(2);
      expect(page1Res.body.meta.hasNextPage).toBe(true);

      // Page 2 with limit 2
      const page2Res = await request(app).get(
        `/api/v1/reviews/doctors/${doctorUser._id.toString()}?page=2&limit=2`
      );
      expect(page2Res.status).toBe(200);
      expect(page2Res.body.data).toHaveLength(1);
      expect(page2Res.body.meta.page).toBe(2);
      expect(page2Res.body.meta.hasNextPage).toBe(false);
    });

    it("E5: Sanitizes patient information and exposes no private profile fields", async () => {
      const appt = await createTestAppointment();
      await request(app)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: appt._id.toString(),
          rating: 5,
          comment: "Privacy test review",
        });

      const res = await request(app).get(
        `/api/v1/reviews/doctors/${doctorUser._id.toString()}`
      );

      expect(res.status).toBe(200);
      const review = res.body.data[0];

      // Safe patient fields
      expect(review.patient).toBeDefined();
      expect(review.patient.id).toBe(patientUser._id.toString());
      expect(review.patient.fullName).toBe("Alice Patient");
      expect(review.patient.avatar).toBe("https://example.com/avatar/alice.jpg");

      // Critical: Ensure no confidential or PII fields leak
      expect(review.patient.email).toBeUndefined();
      expect(review.patient.phone).toBeUndefined();
      expect(review.patient.passwordHash).toBeUndefined();
      expect(review.patient.role).toBeUndefined();
      expect(review.appointmentId).toBeUndefined(); // internal appointment id omitted from public review item
    });

    it("E6: Rejects malformed doctor ID with HTTP 400", async () => {
      const res = await request(app).get("/api/v1/reviews/doctors/not-a-valid-object-id");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("E7: Returns HTTP 404 when querying reviews for a non-existent doctor", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).get(`/api/v1/reviews/doctors/${nonExistentId}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });
  });
});
