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
