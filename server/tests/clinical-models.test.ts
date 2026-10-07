import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import {
  Appointment,
  Consultation,
  MedicalRecord,
  Prescription,
  AppointmentStatus,
  ConsultationStatus,
  MedicalRecordType,
  PrescriptionStatus,
  ConsultationType,
  MedicineRoute,
} from "../src/models/index.js";

describe("Clinical & Appointment Mongoose Models (Task 1.3)", () => {
  describe("Appointment Model", () => {
    it("should instantiate a valid Appointment document with expected defaults", () => {
      const patientId = new mongoose.Types.ObjectId();
      const doctorId = new mongoose.Types.ObjectId();
      const start = new Date("2026-10-20T10:00:00.000Z");
      const end = new Date("2026-10-20T10:30:00.000Z");

      const appointment = new Appointment({
        patientId,
        doctorId,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: start,
        scheduledEnd: end,
        reason: "General cardiac checkup and palpitations",
        fee: 75,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15-minute lock
      });

      expect(appointment.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      expect(appointment.currency).toBe("INR");
      expect(appointment.paymentStatus).toBe("UNPAID");
      expect(appointment.lockExpiresAt).toBeDefined();

      const validationError = appointment.validateSync();
      expect(validationError).toBeUndefined();
    });

    it("should enforce required fields on Appointment", () => {
      const invalidAppt = new Appointment({});
      const err = invalidAppt.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["patientId"]).toBeDefined();
      expect(err?.errors["doctorId"]).toBeDefined();
      expect(err?.errors["appointmentType"]).toBeDefined();
      expect(err?.errors["scheduledStart"]).toBeDefined();
      expect(err?.errors["scheduledEnd"]).toBeDefined();
      expect(err?.errors["reason"]).toBeDefined();
      expect(err?.errors["fee"]).toBeDefined();
    });

    it("should reject invalid AppointmentStatus values", () => {
      const invalidAppt = new Appointment({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        reason: "Checkup",
        fee: 50,
        status: "INVALID_STATUS_XYZ" as unknown as AppointmentStatus,
      });

      const err = invalidAppt.validateSync();
      expect(err?.errors["status"]).toBeDefined();
    });

    it("CRITICAL CONCURRENCY CHECK: should define partial unique index on doctorId + scheduledStart for active states", () => {
      const indexes = Appointment.schema.indexes();

      // Find the index on { doctorId: 1, scheduledStart: 1 }
      const concurrencyIndex = indexes.find(
        ([idx]) => idx["doctorId"] === 1 && idx["scheduledStart"] === 1
      );

      expect(concurrencyIndex).toBeDefined();

      const [indexFields, indexOptions] = concurrencyIndex!;

      // 1. Verify exact fields
      expect(indexFields).toEqual({ doctorId: 1, scheduledStart: 1 });

      // 2. Verify uniqueness is enabled
      expect(indexOptions?.unique).toBe(true);

      // 3. Verify partial filter expression exists
      expect(indexOptions?.partialFilterExpression).toBeDefined();

      // 4. Verify partial filter matches exactly the 3 active states
      const filter = indexOptions?.partialFilterExpression as {
        status?: { $in?: string[] };
      };

      expect(filter.status?.$in).toBeDefined();
      expect(filter.status?.$in).toHaveLength(3);
      expect(filter.status?.$in).toContain(AppointmentStatus.PENDING_PAYMENT);
      expect(filter.status?.$in).toContain(AppointmentStatus.CONFIRMED);
      expect(filter.status?.$in).toContain(AppointmentStatus.IN_PROGRESS);

      // Verify terminal states are excluded from the partial index
      expect(filter.status?.$in).not.toContain(AppointmentStatus.CANCELLED);
      expect(filter.status?.$in).not.toContain(AppointmentStatus.REJECTED);
      expect(filter.status?.$in).not.toContain(AppointmentStatus.RESCHEDULED);
      expect(filter.status?.$in).not.toContain(AppointmentStatus.COMPLETED);
      expect(filter.status?.$in).not.toContain(AppointmentStatus.NO_SHOW);
    });

    it("should support cancellation metadata and format id via toJSONPlugin", () => {
      const appt = new Appointment({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        appointmentType: ConsultationType.AUDIO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        reason: "Followup call",
        fee: 40,
        status: AppointmentStatus.CANCELLED,
        cancellation: {
          reason: "Patient had emergency travel",
          cancelledBy: new mongoose.Types.ObjectId(),
          cancelledAt: new Date(),
        },
      });
      appt.__v = 0;

      const json = appt.toJSON();
      expect(json).toHaveProperty("id");
      expect(json.id).toBe(appt._id.toString());
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
      expect(json.cancellation?.reason).toBe("Patient had emergency travel");
    });
  });

  describe("Consultation Model", () => {
    it("should validate a complete Consultation document", () => {
      const appointmentId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();
      const doctorId = new mongoose.Types.ObjectId();

      const consultation = new Consultation({
        appointmentId,
        patientId,
        doctorId,
        consultationType: ConsultationType.VIDEO,
        roomId: "room_livekit_consultation_12345",
        status: ConsultationStatus.SCHEDULED,
      });

      const err = consultation.validateSync();
      expect(err).toBeUndefined();
      expect(consultation.status).toBe(ConsultationStatus.SCHEDULED);
      expect(consultation.durationSeconds).toBe(0);
    });

    it("should enforce required fields and unique index on appointmentId", () => {
      const invalidConsultation = new Consultation({});
      const err = invalidConsultation.validateSync();

      expect(err?.errors["appointmentId"]).toBeDefined();
      expect(err?.errors["patientId"]).toBeDefined();
      expect(err?.errors["doctorId"]).toBeDefined();
      expect(err?.errors["consultationType"]).toBeDefined();
      expect(err?.errors["roomId"]).toBeDefined();

      const indexes = Consultation.schema.indexes();
      const apptIndex = indexes.find(([idx]) => idx["appointmentId"] === 1);
      expect(apptIndex?.[1]?.unique).toBe(true);
    });

    it("should reject invalid ConsultationStatus values", () => {
      const consultation = new Consultation({
        appointmentId: new mongoose.Types.ObjectId(),
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        consultationType: ConsultationType.VIDEO,
        roomId: "room123",
        status: "INVALID_CONSULT_STATE" as unknown as ConsultationStatus,
      });

      const err = consultation.validateSync();
      expect(err?.errors["status"]).toBeDefined();
    });

    it("should strip private providerMetadata via toJSONPlugin", () => {
      const consultation = new Consultation({
        appointmentId: new mongoose.Types.ObjectId(),
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        consultationType: ConsultationType.VIDEO,
        roomId: "room123",
        providerSessionId: "session_abc",
        providerMetadata: {
          secretToken: "private_livekit_server_token_do_not_leak",
        },
      });
      consultation.__v = 0;

      const json = consultation.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).toHaveProperty("providerSessionId", "session_abc");
      expect(json).not.toHaveProperty("providerMetadata");
    });
  });

  describe("MedicalRecord Model", () => {
    it("should validate a complete MedicalRecord", () => {
      const patientId = new mongoose.Types.ObjectId();
      const uploadedBy = new mongoose.Types.ObjectId();

      const record = new MedicalRecord({
        patientId,
        uploadedBy,
        title: "Complete Blood Count (CBC) Lab Report",
        description: "Routine annual blood work",
        recordType: MedicalRecordType.LAB_REPORT,
        recordDate: new Date("2026-09-15"),
        storageKey: "records/patients/pat_123/cbc_report_2026.pdf",
        fileName: "cbc_report_2026.pdf",
        fileType: "application/pdf",
        sizeBytes: 1048576, // 1 MB
      });

      const err = record.validateSync();
      expect(err).toBeUndefined();
      expect(record.recordType).toBe(MedicalRecordType.LAB_REPORT);
      expect(record.isArchived).toBe(false);
    });

    it("should enforce required ownership, clinical type, and file metadata", () => {
      const record = new MedicalRecord({});
      const err = record.validateSync();

      expect(err?.errors["patientId"]).toBeDefined();
      expect(err?.errors["uploadedBy"]).toBeDefined();
      expect(err?.errors["title"]).toBeDefined();
      expect(err?.errors["recordType"]).toBeDefined();
      expect(err?.errors["storageKey"]).toBeDefined();
      expect(err?.errors["fileName"]).toBeDefined();
      expect(err?.errors["fileType"]).toBeDefined();
      expect(err?.errors["sizeBytes"]).toBeDefined();
    });

    it("should reject invalid MedicalRecordType", () => {
      const record = new MedicalRecord({
        patientId: new mongoose.Types.ObjectId(),
        uploadedBy: new mongoose.Types.ObjectId(),
        title: "Invalid Record",
        recordType: "FORGED_RECORD_TYPE" as unknown as MedicalRecordType,
        storageKey: "key",
        fileName: "file.pdf",
        fileType: "application/pdf",
        sizeBytes: 100,
      });

      const err = record.validateSync();
      expect(err?.errors["recordType"]).toBeDefined();
    });

    it("should strip internal storageKey via toJSONPlugin", () => {
      const record = new MedicalRecord({
        patientId: new mongoose.Types.ObjectId(),
        uploadedBy: new mongoose.Types.ObjectId(),
        title: "Chest X-Ray",
        recordType: MedicalRecordType.XRAY,
        storageKey: "private_s3_bucket_path_key_xyz987",
        fileName: "xray.png",
        fileType: "image/png",
        sizeBytes: 5242880,
      });
      record.__v = 0;

      const json = record.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).toHaveProperty("title", "Chest X-Ray");
      expect(json).not.toHaveProperty("storageKey"); // Stripped for privacy
    });
  });

  describe("Prescription Model", () => {
    it("should validate a complete Prescription with 90-day validity and medicine snapshots", () => {
      const patientId = new mongoose.Types.ObjectId();
      const doctorId = new mongoose.Types.ObjectId();
      const medicineId = new mongoose.Types.ObjectId();
      const now = new Date();
      const expiry90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      const prescription = new Prescription({
        patientId,
        doctorId,
        status: PrescriptionStatus.FINALIZED_ISSUED,
        diagnosis: "Acute Bronchitis and allergic rhinitis",
        medicines: [
          {
            medicineId,
            medicineName: "Amoxicillin 500mg Capsule", // Historical snapshot
            dosage: "500mg",
            frequency: "1-0-1 (Twice daily after food)",
            durationDays: 7,
            quantity: 14,
            route: MedicineRoute.ORAL,
            specialInstructions: "Complete entire 7-day course",
          },
        ],
        additionalNotes: "Drink plenty of warm fluids",
        issuedAt: now,
        expiresAt: expiry90Days,
      });

      const err = prescription.validateSync();
      expect(err).toBeUndefined();
      expect(prescription.medicines).toHaveLength(1);
      expect(prescription.medicines[0].medicineName).toBe("Amoxicillin 500mg Capsule");
      expect(prescription.medicines[0].route).toBe(MedicineRoute.ORAL);
      expect(prescription.expiresAt).toEqual(expiry90Days);
    });

    it("should reject a prescription without at least one medicine item", () => {
      const prescription = new Prescription({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        diagnosis: "Fever",
        medicines: [], // Empty
        expiresAt: new Date(),
      });

      const err = prescription.validateSync();
      expect(err?.errors["medicines"]).toBeDefined();
    });

    it("should enforce required fields (patientId, doctorId, diagnosis, expiresAt)", () => {
      const prescription = new Prescription({});
      const err = prescription.validateSync();

      expect(err?.errors["patientId"]).toBeDefined();
      expect(err?.errors["doctorId"]).toBeDefined();
      expect(err?.errors["diagnosis"]).toBeDefined();
      expect(err?.errors["expiresAt"]).toBeDefined();
    });

    it("should reject invalid PrescriptionStatus and MedicineRoute values", () => {
      const prescription = new Prescription({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        diagnosis: "Asthma",
        status: "NON_EXISTENT_STATUS" as unknown as PrescriptionStatus,
        medicines: [
          {
            medicineId: new mongoose.Types.ObjectId(),
            medicineName: "Inhaler",
            dosage: "2 puffs",
            frequency: "as needed",
            durationDays: 30,
            quantity: 1,
            route: "INTRA_ARTERIAL" as unknown as MedicineRoute,
          },
        ],
        expiresAt: new Date(),
      });

      const err = prescription.validateSync();
      expect(err?.errors["status"]).toBeDefined();
      expect(err?.errors["medicines.0.route"]).toBeDefined();
    });

    it("should verify defined indexes on Prescription schema", () => {
      const indexes = Prescription.schema.indexes();
      const patientIndex = indexes.find(
        ([idx]) => idx["patientId"] === 1 && idx["issuedAt"] === -1
      );
      const doctorIndex = indexes.find(
        ([idx]) => idx["doctorId"] === 1 && idx["issuedAt"] === -1
      );
      const expiryIndex = indexes.find(
        ([idx]) => idx["status"] === 1 && idx["expiresAt"] === 1
      );

      expect(patientIndex).toBeDefined();
      expect(doctorIndex).toBeDefined();
      expect(expiryIndex).toBeDefined();
    });
  });
});
