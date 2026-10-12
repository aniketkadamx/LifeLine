import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, PatientProfile, Appointment } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  BloodGroup,
  Gender,
  AppointmentStatus,
  ConsultationType,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 4 - Task 4.2: Patient Health Profile Management (/api/v1/patients/me/profile)", () => {
  let ipCounter = 200;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.30.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_patient_profile_test");
    await User.syncIndexes();
    await PatientProfile.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({});
      await PatientProfile.deleteMany({});
      await Appointment.deleteMany({});
    }
  });

  // Helper: creates a test user and optional patient profile
  async function createPatientUser(
    profileData: Partial<{
      bloodGroup: BloodGroup;
      gender: Gender;
      dateOfBirth: Date;
      allergies: string[];
      medicalConditions: string[];
      currentMedications: string[];
    }> = {}
  ) {
    const user = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Test Patient",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
    });

    const profile = await PatientProfile.create({
      userId: user._id,
      bloodGroup: profileData.bloodGroup || BloodGroup.O_POSITIVE,
      gender: profileData.gender || Gender.FEMALE,
      dateOfBirth: profileData.dateOfBirth || new Date("1995-06-15T00:00:00.000Z"),
      allergies: profileData.allergies || ["Penicillin"],
      medicalConditions: profileData.medicalConditions || ["Asthma"],
      currentMedications: profileData.currentMedications || ["Albuterol"],
      emergencyContact: {
        name: "Emergency Contact",
        relationship: "Spouse",
        phone: "+15559998877",
      },
    });

    user.patientProfile = profile._id;
    await user.save();

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, profile, token };
  }

  // Helper: creates a test doctor user
  async function createDoctorUser() {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Dr. Sarah Jenkins",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, token };
  }

  // Helper: creates a test pharmacy user
  async function createPharmacyUser() {
    const user = await User.create({
      email: `pharmacy.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Apex Pharmacy",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, token };
  }

  // =========================================================================
  // Test Cases 1 - 3: Basic Retrieval, Update, and Persistence
  // =========================================================================
  describe("1-3: Patient Profile Retrieval, Update & Persistence", () => {
    it("1. Authenticated patient can retrieve their own profile", async () => {
      const { user, profile, token } = await createPatientUser({
        bloodGroup: BloodGroup.A_POSITIVE,
        allergies: ["Peanuts", "Dust"],
      });

      const res = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(profile.id);
      expect(res.body.data.userId).toBe(user.id);
      expect(res.body.data.bloodGroup).toBe("A+");
      expect(res.body.data.allergies).toEqual(["Peanuts", "Dust"]);
      expect(res.body.data.emergencyContact).toBeDefined();
      expect(res.body.data.emergencyContact.name).toBe("Emergency Contact");
    });

    it("2. Authenticated patient can update their own profile", async () => {
      const { user, token } = await createPatientUser();

      const updatePayload = {
        bloodGroup: "B+",
        allergies: ["Sulfa Drugs", "Shellfish"],
        medicalConditions: ["Hypertension"],
        currentMedications: ["Lisinopril 10mg"],
        emergencyContact: {
          name: "John Doe",
          relationship: "Brother",
          phone: "+15551234567",
        },
      };

      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bloodGroup).toBe("B+");
      expect(res.body.data.allergies).toEqual(["Sulfa Drugs", "Shellfish"]);
      expect(res.body.data.medicalConditions).toEqual(["Hypertension"]);
      expect(res.body.data.currentMedications).toEqual(["Lisinopril 10mg"]);
      expect(res.body.data.emergencyContact.name).toBe("John Doe");
      expect(res.body.data.emergencyContact.phone).toBe("+15551234567");
    });

    it("3. Updates persist correctly in MongoDB and preserve omitted fields", async () => {
      const { user, profile, token } = await createPatientUser({
        bloodGroup: BloodGroup.O_POSITIVE,
        allergies: ["Initial Allergy"],
      });

      // Partial update: update ONLY bloodGroup and allergies
      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          bloodGroup: "AB+",
          allergies: ["Updated Allergy"],
        });

      expect(res.status).toBe(200);

      // Verify directly from MongoDB
      const persisted = await PatientProfile.findOne({ userId: user._id });
      expect(persisted).toBeDefined();
      expect(persisted?.bloodGroup).toBe("AB+");
      expect(persisted?.allergies).toEqual(["Updated Allergy"]);

      // Crucial: Omitted fields must be preserved, not wiped
      expect(persisted?.medicalConditions).toEqual(["Asthma"]);
      expect(persisted?.currentMedications).toEqual(["Albuterol"]);
      expect(persisted?.emergencyContact?.name).toBe("Emergency Contact");
      expect(persisted?.emergencyContact?.phone).toBe("+15559998877");
    });
  });

  // =========================================================================
  // Test Cases 4 - 6: Validation Rules
  // =========================================================================
  describe("4-6: Validation Rules (Allergies, Blood Group, Emergency Contacts)", () => {
    it("4. Allergy arrays are validated correctly (reject empty/invalid elements)", async () => {
      const { token } = await createPatientUser();

      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          allergies: ["Valid Allergy", "   ", "Another Allergy"], // whitespace string should fail min(1)
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("5. Invalid blood-group values are rejected according to the contract", async () => {
      const { token } = await createPatientUser();

      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          bloodGroup: "C_UNKNOWN",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("6. Malformed emergency contacts are rejected", async () => {
      const { token } = await createPatientUser();

      // Test invalid phone number (not E.164)
      const resBadPhone = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          emergencyContact: {
            name: "Jane Doe",
            relationship: "Mother",
            phone: "invalid-phone",
          },
        });

      expect(resBadPhone.status).toBe(422);
      expect(resBadPhone.body.error.code).toBe("VALIDATION_ERROR");

      // Test missing required field (relationship)
      const resMissingField = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          emergencyContact: {
            name: "Jane Doe",
            phone: "+15551234567",
          },
        });

      expect(resMissingField.status).toBe(422);
      expect(resMissingField.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // Test Cases 7 - 8: Security Boundaries and Authentication
  // =========================================================================
  describe("7-8: Security Boundaries & Authentication", () => {
    it("7. A patient cannot update another user's profile by tampering with request data", async () => {
      const patientA = await createPatientUser({ bloodGroup: BloodGroup.A_POSITIVE });
      const patientB = await createPatientUser({ bloodGroup: BloodGroup.B_POSITIVE });

      // Patient A attempts to update Patient B by injecting IDs in the body
      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${patientA.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          id: patientB.profile.id,
          userId: patientB.user.id,
          bloodGroup: "AB+",
        });

      // Strict schema rejects injected unauthorized keys with 422
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");

      // Verify Patient B remained completely unchanged
      const persistedB = await PatientProfile.findById(patientB.profile._id);
      expect(persistedB?.bloodGroup).toBe("B+");
    });

    it("8. Missing or invalid authentication is rejected through the existing pipeline", async () => {
      // Unauthenticated GET
      const resGet = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(401);
      expect(resGet.body.error.code).toBe("AUTH_TOKEN_MISSING");

      // Unauthenticated PUT
      const resPut = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("x-test-client-ip", getUniqueIp())
        .send({ bloodGroup: "O+" });

      expect(resPut.status).toBe(401);
      expect(resPut.body.error.code).toBe("AUTH_TOKEN_MISSING");

      // Invalid token
      const resBadToken = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("Authorization", "Bearer invalid.jwt.token")
        .set("x-test-client-ip", getUniqueIp());

      expect(resBadToken.status).toBe(401);
      expect(resBadToken.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  // =========================================================================
  // Test Cases 9 - 10: Doctor Clinical Relationship Authorization
  // =========================================================================
  describe("9-10: Doctor Clinical Relationship Authorization", () => {
    it("9. A doctor cannot read a patient profile without the required authorized relationship", async () => {
      const { user: patientUser, profile: patientProfile } = await createPatientUser();
      const { token: doctorToken } = await createDoctorUser();

      // Doctor tries to access patient's profile without an active appointment
      const res = await request(app)
        .get(`/api/v1/patients/${patientUser.id}/profile`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Doctor also cannot access via query parameter
      const resQuery = await request(app)
        .get(`/api/v1/patients/me/profile?patientId=${patientUser.id}`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resQuery.status).toBe(403);
      expect(resQuery.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("10. An authorized doctor read is permitted when an active clinical relationship exists", async () => {
      const { user: patientUser, profile: patientProfile } = await createPatientUser({
        bloodGroup: BloodGroup.AB_NEGATIVE,
        allergies: ["Amoxicillin"],
      });
      const { user: doctorUser, token: doctorToken } = await createDoctorUser();

      // Create an active confirmed appointment establishing the clinical relationship
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date(Date.now() + 86400000),
        scheduledEnd: new Date(Date.now() + 86400000 + 1800000),
        appointmentType: ConsultationType.VIDEO,
        status: AppointmentStatus.CONFIRMED,
        reason: "Cardiology follow-up",
        fee: 750,
      });

      // Doctor reads patient profile via :id/profile route
      const resParam = await request(app)
        .get(`/api/v1/patients/${patientUser.id}/profile`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resParam.status).toBe(200);
      expect(resParam.body.success).toBe(true);
      expect(resParam.body.data.bloodGroup).toBe("AB-");
      expect(resParam.body.data.allergies).toContain("Amoxicillin");

      // Doctor reads patient profile via query parameter on /me/profile
      const resQuery = await request(app)
        .get(`/api/v1/patients/me/profile?patientId=${patientUser.id}`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resQuery.status).toBe(200);
      expect(resQuery.body.success).toBe(true);
      expect(resQuery.body.data.bloodGroup).toBe("AB-");
    });

    it("Doctor cannot mutate (PUT) a patient profile", async () => {
      const { user: patientUser } = await createPatientUser();
      const { user: doctorUser, token: doctorToken } = await createDoctorUser();

      // Even if doctor has relationship:
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date(Date.now() + 86400000),
        scheduledEnd: new Date(Date.now() + 86400000 + 1800000),
        appointmentType: ConsultationType.VIDEO,
        status: AppointmentStatus.CONFIRMED,
        reason: "Follow-up",
        fee: 500,
      });

      const res = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ bloodGroup: "O+" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });
  });

  // =========================================================================
  // Test Cases 11 - 12: Missing Profile and Error Formatting
  // =========================================================================
  describe("11-12: Error Formatting & Database Error Handling", () => {
    it("11. Missing profile and validation failures use the documented response/error format", async () => {
      // Create user without patient profile
      const user = await User.create({
        email: `orphan.${Date.now()}@example.com`,
        phone: "+15550001122",
        passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
        fullName: "Orphan User",
        role: UserRole.PATIENT,
        status: UserStatus.ACTIVE,
      });
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Patient profile not found",
          timestamp: expect.any(String),
        },
      });
    });

    it("12. Non-patient roles (e.g. PHARMACY) are strictly rejected with HTTP 403", async () => {
      const { token: pharmacyToken } = await createPharmacyUser();

      const resGet = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(403);
      expect(resGet.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPut = await request(app)
        .put("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ bloodGroup: "O+" });

      expect(resPut.status).toBe(403);
      expect(resPut.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("13. Private database fields and version keys are not leaked", async () => {
      const { token } = await createPatientUser();

      const res = await request(app)
        .get("/api/v1/patients/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.__v).toBeUndefined();
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("__v");
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    });
  });
});
