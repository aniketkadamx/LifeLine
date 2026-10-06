import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import {
  User,
  PatientProfile,
  DoctorProfile,
  PharmacyProfile,
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  Gender,
  BloodGroup,
  ConsultationType,
} from "../src/models/index.js";

describe("Identity & Profile Mongoose Models (Task 1.2)", () => {
  describe("User Model", () => {
    it("should instantiate a valid User document with expected defaults", () => {
      const user = new User({
        email: "Doctor.Sarah@Example.COM", // tests lowercase & trim
        phone: " +15551234567 ",
        passwordHash: "$2a$12$eX4mpleH4shV4lueTh4tIsSecur3",
        fullName: "Dr. Sarah Jenkins",
      });

      expect(user.email).toBe("doctor.sarah@example.com");
      expect(user.phone).toBe("+15551234567");
      expect(user.role).toBe(UserRole.PATIENT); // Default role
      expect(user.status).toBe(UserStatus.ACTIVE); // Default status
      expect(user.emailVerified).toBe(false);
      expect(user.phoneVerified).toBe(false);

      const validationError = user.validateSync();
      expect(validationError).toBeUndefined();
    });

    it("should enforce required fields (email, phone, passwordHash, fullName)", () => {
      const invalidUser = new User({});
      const err = invalidUser.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["email"]).toBeDefined();
      expect(err?.errors["phone"]).toBeDefined();
      expect(err?.errors["passwordHash"]).toBeDefined();
      expect(err?.errors["fullName"]).toBeDefined();
    });

    it("should reject invalid UserRole and UserStatus values", () => {
      const invalidUser = new User({
        email: "test@example.com",
        phone: "+1234567890",
        passwordHash: "hash",
        fullName: "Test User",
        role: "SUPER_GOD_MODE" as unknown as UserRole,
        status: "BANNED_FOR_LIFE" as unknown as UserStatus,
      });

      const err = invalidUser.validateSync();
      expect(err?.errors["role"]).toBeDefined();
      expect(err?.errors["status"]).toBeDefined();
    });

    it("should strip passwordHash and format id via toJSONPlugin", () => {
      const user = new User({
        email: "test@example.com",
        phone: "+1234567890",
        passwordHash: "$2a$12$superSecretHashValue12345",
        fullName: "Test User",
      });
      user.__v = 0;

      const json = user.toJSON();

      expect(json).toHaveProperty("id");
      expect(json.id).toBe(user._id.toString());
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
      expect(json).not.toHaveProperty("passwordHash");
    });

    it("should verify unique indexes defined on email and phone", () => {
      const indexes = User.schema.indexes();
      const emailIndex = indexes.find(([idx]) => idx["email"] === 1);
      const phoneIndex = indexes.find(([idx]) => idx["phone"] === 1);

      expect(emailIndex).toBeDefined();
      expect(emailIndex?.[1]?.unique).toBe(true);
      expect(phoneIndex).toBeDefined();
      expect(phoneIndex?.[1]?.unique).toBe(true);
    });
  });

  describe("PatientProfile Model", () => {
    it("should validate a complete PatientProfile with address and emergency contact", () => {
      const userId = new mongoose.Types.ObjectId();
      const patient = new PatientProfile({
        userId,
        dateOfBirth: new Date("1990-05-15"),
        gender: Gender.FEMALE,
        bloodGroup: BloodGroup.O_POSITIVE,
        address: {
          city: "New York",
          state: "NY",
          postalCode: "10001",
          country: "USA",
        },
        emergencyContact: {
          name: "John Doe",
          relationship: "Spouse",
          phone: "+15559876543",
        },
        allergies: ["Penicillin", "Peanuts"],
      });

      const err = patient.validateSync();
      expect(err).toBeUndefined();
      expect(patient.allergies).toHaveLength(2);
      expect(patient.medicalConditions).toEqual([]);
    });

    it("should require userId and enforce unique index for 1-to-1 relationship", () => {
      const patient = new PatientProfile({});
      const err = patient.validateSync();
      expect(err?.errors["userId"]).toBeDefined();

      const indexes = PatientProfile.schema.indexes();
      const userIndex = indexes.find(([idx]) => idx["userId"] === 1);
      expect(userIndex).toBeDefined();
      expect(userIndex?.[1]?.unique).toBe(true);
    });

    it("should validate gender and blood group enums", () => {
      const patient = new PatientProfile({
        userId: new mongoose.Types.ObjectId(),
        gender: "UNKNOWN_GENDER" as unknown as Gender,
        bloodGroup: "C_POSITIVE" as unknown as BloodGroup,
      });

      const err = patient.validateSync();
      expect(err?.errors["gender"]).toBeDefined();
      expect(err?.errors["bloodGroup"]).toBeDefined();
    });
  });

  describe("DoctorProfile Model", () => {
    it("should validate a complete DoctorProfile with discovery defaults", () => {
      const userId = new mongoose.Types.ObjectId();
      const doctor = new DoctorProfile({
        userId,
        specialization: "CARDIOLOGY",
        qualifications: ["MBBS", "MD Cardiology"],
        experienceYears: 12,
        registrationNumber: " med-reg-98765 ", // tests uppercase & trim
        registrationCouncil: "State Medical Council",
        consultationFee: 150,
      });

      expect(doctor.registrationNumber).toBe("MED-REG-98765");
      expect(doctor.verificationStatus).toBe(DoctorVerificationStatus.UNSUBMITTED);
      expect(doctor.consultationTypes).toContain(ConsultationType.VIDEO);
      expect(doctor.rating).toBe(0);
      expect(doctor.totalReviews).toBe(0);

      const err = doctor.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject negative consultation fee or experience", () => {
      const doctor = new DoctorProfile({
        userId: new mongoose.Types.ObjectId(),
        specialization: "DERMATOLOGY",
        qualifications: ["MBBS"],
        experienceYears: -2,
        registrationNumber: "REG123",
        registrationCouncil: "Council",
        consultationFee: -50,
      });

      const err = doctor.validateSync();
      expect(err?.errors["experienceYears"]).toBeDefined();
      expect(err?.errors["consultationFee"]).toBeDefined();
    });

    it("should require at least one qualification", () => {
      const doctor = new DoctorProfile({
        userId: new mongoose.Types.ObjectId(),
        specialization: "DERMATOLOGY",
        qualifications: [],
        experienceYears: 5,
        registrationNumber: "REG123",
        registrationCouncil: "Council",
        consultationFee: 100,
      });

      const err = doctor.validateSync();
      expect(err?.errors["qualifications"]).toBeDefined();
    });

    it("should strip private verification document fileKey via toJSONPlugin", () => {
      const doctor = new DoctorProfile({
        userId: new mongoose.Types.ObjectId(),
        specialization: "PEDIATRICS",
        qualifications: ["MBBS"],
        experienceYears: 4,
        registrationNumber: "REG456",
        registrationCouncil: "Council",
        consultationFee: 80,
        verificationDocuments: [
          {
            documentType: "MEDICAL_LICENSE",
            fileKey: "super_secret_s3_storage_key_abc123",
          },
        ],
      });
      doctor.__v = 0;

      const json = doctor.toJSON();
      expect(json).toHaveProperty("id");
      expect(json.verificationDocuments[0]).not.toHaveProperty("fileKey");
    });

    it("should define compound discovery index and registration number uniqueness", () => {
      const indexes = DoctorProfile.schema.indexes();
      const regIndex = indexes.find(([idx]) => idx["registrationNumber"] === 1);
      const userIndex = indexes.find(([idx]) => idx["userId"] === 1);
      const discoveryIndex = indexes.find(
        ([idx]) => idx["verificationStatus"] === 1 && idx["specialization"] === 1 && idx["rating"] === -1
      );

      expect(regIndex?.[1]?.unique).toBe(true);
      expect(userIndex?.[1]?.unique).toBe(true);
      expect(discoveryIndex).toBeDefined();
    });
  });

  describe("PharmacyProfile Model", () => {
    it("should validate a complete PharmacyProfile", () => {
      const userId = new mongoose.Types.ObjectId();
      const pharmacy = new PharmacyProfile({
        userId,
        pharmacyName: "LifeLine Central Pharmacy",
        ownerName: "Robert Miller",
        licenseNumber: " ph-lic-554433 ", // tests uppercase & trim
        address: {
          street: "456 Health Blvd",
          city: "Boston",
          state: "MA",
          postalCode: "02115",
          country: "USA",
        },
        phone: "+15554321098",
      });

      expect(pharmacy.licenseNumber).toBe("PH-LIC-554433");
      expect(pharmacy.verificationStatus).toBe(PharmacyVerificationStatus.UNSUBMITTED);
      expect(pharmacy.deliveryAvailable).toBe(true);

      const err = pharmacy.validateSync();
      expect(err).toBeUndefined();
    });

    it("should enforce required fields on PharmacyProfile", () => {
      const pharmacy = new PharmacyProfile({});
      const err = pharmacy.validateSync();

      expect(err?.errors["userId"]).toBeDefined();
      expect(err?.errors["pharmacyName"]).toBeDefined();
      expect(err?.errors["ownerName"]).toBeDefined();
      expect(err?.errors["licenseNumber"]).toBeDefined();
      expect(err?.errors["address"]).toBeDefined();
      expect(err?.errors["phone"]).toBeDefined();
    });

    it("should verify unique indexes on licenseNumber and userId", () => {
      const indexes = PharmacyProfile.schema.indexes();
      const licIndex = indexes.find(([idx]) => idx["licenseNumber"] === 1);
      const userIndex = indexes.find(([idx]) => idx["userId"] === 1);

      expect(licIndex?.[1]?.unique).toBe(true);
      expect(userIndex?.[1]?.unique).toBe(true);
    });
  });
});
