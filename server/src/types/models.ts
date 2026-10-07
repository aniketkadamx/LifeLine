import type { Types } from "mongoose";

/**
 * Universal user role definitions across the LifeLine platform.
 * Source: PROJECT_CONTEXT.md Section 12, AUTHORIZATION_MATRIX.md Section 1.
 */
export enum UserRole {
  PATIENT = "PATIENT",
  DOCTOR = "DOCTOR",
  PHARMACY = "PHARMACY",
  ADMIN = "ADMIN",
}

/**
 * Account lifecycle statuses.
 * Source: PROJECT_CONTEXT.md Section 27, API_CONTRACT.md Group 18.
 */
export enum UserStatus {
  ACTIVE = "ACTIVE",
  PENDING_VERIFICATION = "PENDING_VERIFICATION",
  SUSPENDED = "SUSPENDED",
  DEACTIVATED = "DEACTIVATED",
}

/**
 * Doctor credential verification lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 6.
 */
export enum DoctorVerificationStatus {
  UNSUBMITTED = "UNSUBMITTED",
  PENDING_REVIEW = "PENDING_REVIEW",
  INFO_REQUESTED = "INFO_REQUESTED",
  APPROVED_VERIFIED = "APPROVED_VERIFIED",
  REJECTED = "REJECTED",
  SUSPENDED = "SUSPENDED",
}

/**
 * Pharmacy drug license verification lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 7.
 */
export enum PharmacyVerificationStatus {
  UNSUBMITTED = "UNSUBMITTED",
  PENDING_REVIEW = "PENDING_REVIEW",
  LICENSE_VERIFYING = "LICENSE_VERIFYING",
  APPROVED_VERIFIED = "APPROVED_VERIFIED",
  REJECTED = "REJECTED",
  SUSPENDED = "SUSPENDED",
}

/**
 * Patient biological gender definition.
 */
export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  OTHER = "OTHER",
}

/**
 * Blood group classification.
 */
export enum BloodGroup {
  A_POSITIVE = "A+",
  A_NEGATIVE = "A-",
  B_POSITIVE = "B+",
  B_NEGATIVE = "B-",
  AB_POSITIVE = "AB+",
  AB_NEGATIVE = "AB-",
  O_POSITIVE = "O+",
  O_NEGATIVE = "O-",
}

/**
 * Supported consultation modality types.
 */
export enum ConsultationType {
  VIDEO = "VIDEO",
  AUDIO = "AUDIO",
  CHAT = "CHAT",
  IN_PERSON = "IN_PERSON",
}

/**
 * Appointment lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 1.1.
 */
export enum AppointmentStatus {
  PENDING_PAYMENT = "PENDING_PAYMENT",
  CONFIRMED = "CONFIRMED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REJECTED = "REJECTED",
  RESCHEDULED = "RESCHEDULED",
  NO_SHOW = "NO_SHOW",
}

/**
 * Virtual consultation lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 2.1.
 */
export enum ConsultationStatus {
  SCHEDULED = "SCHEDULED",
  ROOM_OPENED = "ROOM_OPENED",
  IN_CONSULTATION = "IN_CONSULTATION",
  PAUSED = "PAUSED",
  ENDED = "ENDED",
  COMPLETED = "COMPLETED",
}

/**
 * Clinical document category classification.
 * Source: PROJECT_CONTEXT.md Section 36, docs/api/API_CONTRACT.md Section 8.2.
 */
export enum MedicalRecordType {
  LAB_REPORT = "LAB_REPORT",
  PRESCRIPTION = "PRESCRIPTION",
  XRAY = "XRAY",
  MRI = "MRI",
  CT_SCAN = "CT_SCAN",
  DIAGNOSIS_DOCUMENT = "DIAGNOSIS_DOCUMENT",
  OTHER = "OTHER",
}

/**
 * Digital prescription lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 3.1.
 */
export enum PrescriptionStatus {
  DRAFT = "DRAFT",
  FINALIZED_ISSUED = "FINALIZED_ISSUED",
  FULFILLED_PARTIAL = "FULFILLED_PARTIAL",
  FULFILLED_COMPLETE = "FULFILLED_COMPLETE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
}

/**
 * Prescribed medication route of administration.
 * Source: docs/api/API_CONTRACT.md Section 9.1.
 */
export enum MedicineRoute {
  ORAL = "ORAL",
  TOPICAL = "TOPICAL",
  INJECTION = "INJECTION",
  DROPS = "DROPS",
  INHALATION = "INHALATION",
}

/**
 * Common address schema interface.
 */
export interface IAddress {
  street?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: [number, number]; // [longitude, latitude] for geospatial queries
}

/**
 * Emergency contact interface for patients.
 */
export interface IEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

/**
 * Verification document attachment metadata.
 */
export interface IVerificationDocument {
  documentType: "MEDICAL_LICENSE" | "DEGREE_CERTIFICATE" | "GOVERNMENT_ID" | "PHARMACY_LICENSE" | "OTHER";
  fileKey: string;
  uploadedAt: Date;
}

/**
 * Base User document interface.
 */
export interface IUser {
  _id: Types.ObjectId;
  id?: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  fullName: string;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt?: Date;
  patientProfile?: Types.ObjectId;
  doctorProfile?: Types.ObjectId;
  pharmacyProfile?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PatientProfile document interface.
 */
export interface IPatientProfile {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  dateOfBirth?: Date;
  gender?: Gender;
  bloodGroup?: BloodGroup;
  address?: IAddress;
  emergencyContact?: IEmergencyContact;
  allergies: string[];
  medicalConditions: string[];
  currentMedications: string[];
  profilePhoto?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DoctorProfile document interface.
 */
export interface IDoctorProfile {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  specialization: string;
  qualifications: string[];
  experienceYears: number;
  registrationNumber: string;
  registrationCouncil: string;
  clinicName?: string;
  clinicAddress?: IAddress;
  languages: string[];
  consultationFee: number;
  consultationTypes: ConsultationType[];
  bio?: string;
  verificationStatus: DoctorVerificationStatus;
  verificationDocuments: IVerificationDocument[];
  verificationReviewedBy?: Types.ObjectId;
  verificationReviewedAt?: Date;
  verificationNotes?: string;
  rating: number;
  totalReviews: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PharmacyProfile document interface.
 */
export interface IPharmacyProfile {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  pharmacyName: string;
  ownerName: string;
  licenseNumber: string;
  address: IAddress;
  phone: string;
  email?: string;
  openingHours?: {
    openTime: string;
    closeTime: string;
    closedDays?: string[];
  };
  verificationStatus: PharmacyVerificationStatus;
  licenseDocuments: IVerificationDocument[];
  verificationReviewedBy?: Types.ObjectId;
  verificationReviewedAt?: Date;
  verificationNotes?: string;
  deliveryAvailable: boolean;
  serviceArea: string[];
  rating: number;
  totalReviews: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cancellation audit details for appointments.
 */
export interface IAppointmentCancellation {
  reason: string;
  cancelledBy?: Types.ObjectId;
  cancelledAt: Date;
}

/**
 * Appointment document interface.
 */
export interface IAppointment {
  _id: Types.ObjectId;
  id?: string;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  appointmentType: ConsultationType;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: AppointmentStatus;
  reason: string;
  fee: number;
  currency: string;
  paymentId?: Types.ObjectId | string;
  paymentStatus?: "UNPAID" | "PENDING" | "PAID" | "REFUNDED";
  lockExpiresAt?: Date; // 15-minute reservation lock expiration
  consultationId?: Types.ObjectId;
  cancellation?: IAppointmentCancellation;
  rescheduledFrom?: Types.ObjectId;
  rescheduledTo?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Consultation document interface.
 */
export interface IConsultation {
  _id: Types.ObjectId;
  id?: string;
  appointmentId: Types.ObjectId;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  consultationType: ConsultationType;
  status: ConsultationStatus;
  roomId: string;
  startedAt?: Date;
  endedAt?: Date;
  pausedAt?: Date;
  pauseGraceExpiresAt?: Date;
  durationSeconds?: number;
  diagnosis?: string;
  clinicalNotes?: string;
  recommendedFollowUpDays?: number;
  prescriptionId?: Types.ObjectId;
  providerSessionId?: string;
  providerMetadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MedicalRecord document interface.
 */
export interface IMedicalRecord {
  _id: Types.ObjectId;
  id?: string;
  patientId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  relatedAppointmentId?: Types.ObjectId;
  relatedConsultationId?: Types.ObjectId;
  title: string;
  description?: string;
  recordType: MedicalRecordType;
  recordDate: Date;
  storageKey: string; // Internal cloud storage key (private)
  fileName: string;
  fileType: string; // e.g. "application/pdf"
  sizeBytes: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Historical snapshot item of a prescribed medication.
 */
export interface IPrescriptionMedicineItem {
  medicineId: Types.ObjectId;
  medicineName: string; // Historical catalog snapshot
  dosage: string; // e.g. "500mg"
  frequency: string; // e.g. "1-0-1 (After food)"
  durationDays: number;
  quantity: number;
  route: MedicineRoute;
  specialInstructions?: string;
}

/**
 * Prescription document interface.
 */
export interface IPrescription {
  _id: Types.ObjectId;
  id?: string;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  consultationId?: Types.ObjectId;
  status: PrescriptionStatus;
  diagnosis: string;
  medicines: IPrescriptionMedicineItem[];
  additionalNotes?: string;
  issuedAt?: Date;
  expiresAt: Date; // Standard 90-day validity window
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  revocationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
