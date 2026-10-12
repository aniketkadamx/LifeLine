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
  avatar?: string;
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

/**
 * Common pharmaceutical dosage forms.
 * Source: docs/api/API_CONTRACT.md Group 10.
 */
export enum DosageForm {
  TABLET = "TABLET",
  CAPSULE = "CAPSULE",
  SYRUP = "SYRUP",
  INJECTION = "INJECTION",
  OINTMENT = "OINTMENT",
  DROPS = "DROPS",
  INHALER = "INHALER",
  POWDER = "POWDER",
  OTHER = "OTHER",
}

/**
 * Medicine Order lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 4.1.
 */
export enum OrderStatus {
  PLACED = "PLACED",
  PRESCRIPTION_REVIEW = "PRESCRIPTION_REVIEW",
  PHARMACY_ACCEPTED = "PHARMACY_ACCEPTED",
  PREPARING = "PREPARING",
  READY_FOR_DELIVERY = "READY_FOR_DELIVERY",
  OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
  REJECTED = "REJECTED",
  FAILED = "FAILED",
  RETURNED = "RETURNED",
}

/**
 * Payment transaction lifecycle state machine.
 * Source: docs/api/STATE_MACHINES.md Section 5.1.
 */
export enum PaymentStatus {
  CREATED = "CREATED",
  PENDING_GATEWAY = "PENDING_GATEWAY",
  PROCESSING = "PROCESSING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  REFUND_PENDING = "REFUND_PENDING",
  REFUNDED = "REFUNDED",
}

/**
 * Payment payable target entity type.
 * Source: docs/api/API_CONTRACT.md Group 13.1.
 */
export enum PaymentTargetType {
  APPOINTMENT = "APPOINTMENT",
  ORDER = "ORDER",
}

/**
 * Payment gateway provider.
 * Source: docs/api/API_CONTRACT.md Group 13.1, PROJECT_CONTEXT.md.
 */
export enum PaymentProvider {
  RAZORPAY = "RAZORPAY",
  STRIPE = "STRIPE",
}

/**
 * Security and clinical audited actions.
 * Source: docs/api/AUTHORIZATION_MATRIX.md Section 6.2.
 */
export enum AuditAction {
  // Authentication & Identity Actions
  AUTH_LOGIN = "AUTH_LOGIN",
  AUTH_LOGOUT = "AUTH_LOGOUT",
  USER_CREATED = "USER_CREATED",
  USER_UPDATED = "USER_UPDATED",
  USER_ACCOUNT_SUSPENDED = "USER_ACCOUNT_SUSPENDED",
  USER_ACCOUNT_REINSTATED = "USER_ACCOUNT_REINSTATED",

  // Clinical & Profile Actions
  PATIENT_PROFILE_ACCESSED = "PATIENT_PROFILE_ACCESSED",
  DOCTOR_PROFILE_ACCESSED = "DOCTOR_PROFILE_ACCESSED",
  DOCTOR_VERIFICATION_SUBMITTED = "DOCTOR_VERIFICATION_SUBMITTED",
  DOCTOR_VERIFICATION_APPROVED = "DOCTOR_VERIFICATION_APPROVED",
  DOCTOR_VERIFICATION_REJECTED = "DOCTOR_VERIFICATION_REJECTED",
  PHARMACY_VERIFICATION_APPROVED = "PHARMACY_VERIFICATION_APPROVED",
  PHARMACY_VERIFICATION_REJECTED = "PHARMACY_VERIFICATION_REJECTED",
  MEDICAL_RECORD_VIEWED = "MEDICAL_RECORD_VIEWED",
  MEDICAL_RECORD_DOWNLOADED = "MEDICAL_RECORD_DOWNLOADED",
  MEDICAL_RECORD_ACCESSED = "MEDICAL_RECORD_ACCESSED",
  MEDICAL_RECORD_UPLOADED = "MEDICAL_RECORD_UPLOADED",
  PRESCRIPTION_ISSUED = "PRESCRIPTION_ISSUED",
  PRESCRIPTION_REVOKED = "PRESCRIPTION_REVOKED",
  PRESCRIPTION_CREATED = "PRESCRIPTION_CREATED",
  PRESCRIPTION_VIEWED = "PRESCRIPTION_VIEWED",
  CLINICAL_NOTE_MODIFIED = "CLINICAL_NOTE_MODIFIED",

  // Appointment Actions
  APPOINTMENT_CREATED = "APPOINTMENT_CREATED",
  APPOINTMENT_CANCELLED = "APPOINTMENT_CANCELLED",
  APPOINTMENT_CANCELLED_BY_DOCTOR = "APPOINTMENT_CANCELLED_BY_DOCTOR",

  // Commerce & Financial Actions
  ORDER_CREATED = "ORDER_CREATED",
  ORDER_STATUS_CHANGED = "ORDER_STATUS_CHANGED",
  ORDER_PRESCRIPTION_VERIFIED = "ORDER_PRESCRIPTION_VERIFIED",
  ORDER_PRESCRIPTION_REJECTED = "ORDER_PRESCRIPTION_REJECTED",
  PAYMENT_VERIFIED = "PAYMENT_VERIFIED",
  PAYMENT_REFUND_ISSUED = "PAYMENT_REFUND_ISSUED",

  // Operational & Dispute Actions
  COMPLAINT_CREATED = "COMPLAINT_CREATED",
  ADMIN_ACTION = "ADMIN_ACTION",
  OTHER = "OTHER",
}

/**
 * System notification categories.
 * Source: docs/api/API_CONTRACT.md Group 14, docs/api/STATE_MACHINES.md.
 */
export enum NotificationType {
  APPOINTMENT_CONFIRMED = "APPOINTMENT_CONFIRMED",
  APPOINTMENT_CANCELLED = "APPOINTMENT_CANCELLED",
  APPOINTMENT_RESCHEDULED = "APPOINTMENT_RESCHEDULED",
  APPOINTMENT_REMINDER = "APPOINTMENT_REMINDER",
  CONSULTATION_ROOM_OPENED = "CONSULTATION_ROOM_OPENED",
  PRESCRIPTION_ISSUED = "PRESCRIPTION_ISSUED",
  PRESCRIPTION_REVOKED = "PRESCRIPTION_REVOKED",
  ORDER_PLACED = "ORDER_PLACED",
  ORDER_ACCEPTED = "ORDER_ACCEPTED",
  ORDER_STATUS_UPDATED = "ORDER_STATUS_UPDATED",
  ORDER_DELIVERED = "ORDER_DELIVERED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  PAYMENT_SUCCESS = "PAYMENT_SUCCESS",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  REFUND_PROCESSED = "REFUND_PROCESSED",
  DOCTOR_VERIFIED = "DOCTOR_VERIFIED",
  DOCTOR_REJECTED = "DOCTOR_REJECTED",
  PHARMACY_VERIFIED = "PHARMACY_VERIFIED",
  PHARMACY_REJECTED = "PHARMACY_REJECTED",
  NEW_MESSAGE = "NEW_MESSAGE",
  SYSTEM_ALERT = "SYSTEM_ALERT",
}

/**
 * Review moderation status.
 * Source: docs/api/API_CONTRACT.md Group 16.
 */
export enum ReviewStatus {
  PUBLISHED = "PUBLISHED",
  HIDDEN = "HIDDEN",
  UNDER_REVIEW = "UNDER_REVIEW",
}

/**
 * User complaint and dispute categories.
 * Source: docs/api/API_CONTRACT.md Group 17.1.
 */
export enum ComplaintCategory {
  APPOINTMENT = "APPOINTMENT",
  DOCTOR_CONDUCT = "DOCTOR_CONDUCT",
  MEDICINE_QUALITY = "MEDICINE_QUALITY",
  DELIVERY = "DELIVERY",
  PAYMENT = "PAYMENT",
  OTHER = "OTHER",
}

/**
 * Complaint lifecycle resolution states.
 * Source: docs/api/API_CONTRACT.md Group 17.
 */
export enum ComplaintStatus {
  OPEN = "OPEN",
  UNDER_REVIEW = "UNDER_REVIEW",
  RESOLVED = "RESOLVED",
  REJECTED = "REJECTED",
}

/**
 * Complaint triage priority levels.
 * Source: docs/api/API_CONTRACT.md Group 17.
 */
export enum ComplaintPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

/**
 * Master catalog Medicine document interface.
 */
export interface IMedicine {
  _id: Types.ObjectId;
  id?: string;
  name: string;
  genericName: string;
  brandName?: string;
  manufacturer: string;
  dosageForm: DosageForm;
  strength?: string;
  category?: string;
  description?: string;
  prescriptionRequired: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pharmacy Inventory document interface.
 */
export interface IInventory {
  _id: Types.ObjectId;
  id?: string;
  pharmacyId: Types.ObjectId;
  medicineId: Types.ObjectId;
  quantity: number;
  reservedQuantity: number;
  price: number;
  batchNumber?: string;
  expiryDate?: Date;
  isAvailable: boolean;
  lowStockThreshold: number;
  reorderQuantity?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Historical snapshot item of a purchased medication in an Order.
 */
export interface IOrderItemSnapshot {
  medicineId: Types.ObjectId;
  medicineName: string;
  dosageForm?: string;
  strength?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/**
 * Monetary breakdown totals for an Order.
 */
export interface IOrderTotals {
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
}

/**
 * Pharmacist review decision for prescription-bearing orders.
 */
export interface IOrderPrescriptionReview {
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  decision?: "APPROVE" | "REJECT";
  rejectionReason?: string;
}

/**
 * Medicine Order document interface.
 */
export interface IOrder {
  _id: Types.ObjectId;
  id?: string;
  patientId: Types.ObjectId;
  pharmacyId: Types.ObjectId;
  items: IOrderItemSnapshot[];
  prescriptionId?: Types.ObjectId;
  paymentId?: Types.ObjectId | string;
  paymentStatus: "UNPAID" | "PENDING" | "PAID" | "REFUNDED";
  status: OrderStatus;
  deliveryAddress: IAddress;
  totals: IOrderTotals;
  currency: string;
  deliveryOtp?: string; // Private verification code
  deliveryNotes?: string;
  prescriptionReview?: IOrderPrescriptionReview;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Payment transaction document interface.
 */
export interface IPayment {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  targetType: PaymentTargetType;
  targetId: Types.ObjectId;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  referenceId: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerSignature?: string; // Private
  failureCode?: string;
  failureReason?: string;
  refundId?: string;
  refundAmount?: number;
  refundReason?: string;
  refundStatus?: string;
  refundedAt?: Date;
  gatewayMetadata?: Record<string, unknown>; // Private
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Security and operational audit log record interface.
 */
export interface IAuditLog {
  _id: Types.ObjectId;
  id?: string;
  actorId: Types.ObjectId;
  actorRole: "PATIENT" | "DOCTOR" | "PHARMACY" | "ADMIN" | "SYSTEM";
  action: AuditAction | string;
  resourceType: string;
  resourceId: string;
  patientId?: Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>; // Private
  status: "SUCCESS" | "FAILURE";
  createdAt: Date;
}

/**
 * User application notification document interface.
 */
export interface INotification {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  readAt?: Date;
  relatedEntityType?: string;
  relatedEntityId?: Types.ObjectId;
  channels: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Review document interface.
 */
export interface IReview {
  _id: Types.ObjectId;
  id?: string;
  patientId: Types.ObjectId;
  doctorId?: Types.ObjectId;
  pharmacyId?: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  orderId?: Types.ObjectId;
  rating: number;
  comment: string;
  status: ReviewStatus;
  moderationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Complaint resolution information.
 */
export interface IComplaintResolution {
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolutionNotes?: string;
}

/**
 * Platform complaint and dispute document interface.
 */
export interface IComplaint {
  _id: Types.ObjectId;
  id?: string;
  complainantId: Types.ObjectId;
  category: ComplaintCategory;
  subject: string;
  description: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  assignedTo?: Types.ObjectId;
  resolution?: IComplaintResolution;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Refresh token family tracking and reuse detection document interface.
 * Source: docs/api/API_CONTRACT.md Section 1.5, MASTER_IMPLEMENTATION_ROADMAP.md Task 3.1.
 */
export interface IRefreshToken {
  _id: Types.ObjectId;
  id?: string;
  userId: Types.ObjectId;
  familyId: string;
  jti: string;
  tokenHash: string;
  isRevoked: boolean;
  expiresAt: Date;
  replacedByJti?: string;
  createdAt: Date;
  updatedAt: Date;
}
