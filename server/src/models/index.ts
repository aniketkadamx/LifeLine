// Core Identity & Profile Models
export { User } from "./user.model.js";
export { PatientProfile } from "./patient-profile.model.js";
export { DoctorProfile } from "./doctor-profile.model.js";
export { PharmacyProfile } from "./pharmacy-profile.model.js";

// Clinical & Appointment Models
export { DoctorAvailability } from "./doctor-availability.model.js";
export { Appointment } from "./appointment.model.js";
export { Consultation } from "./consultation.model.js";
export { MedicalRecord } from "./medical-record.model.js";
export { Prescription } from "./prescription.model.js";

// Commerce & Operational Models
export { Medicine } from "./medicine.model.js";
export { Inventory } from "./inventory.model.js";
export { Order } from "./order.model.js";
export { Payment } from "./payment.model.js";
export { AuditLog } from "./audit-log.model.js";
export { Notification } from "./notification.model.js";
export { Review } from "./review.model.js";
export { Complaint } from "./complaint.model.js";
export { RefreshToken } from "./refresh-token.model.js";
export {
  IdempotencyRecord,
  IdempotencyStatus,
  type IIdempotencyRecord,
} from "./idempotency.model.js";

// Plugins
export { toJSONPlugin } from "./plugins/index.js";

// Re-export shared domain enums & types
export {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  DayOfWeek,
  Gender,
  BloodGroup,
  ConsultationType,
  AppointmentStatus,
  ConsultationStatus,
  MedicalRecordType,
  PrescriptionStatus,
  MedicineRoute,
  DosageForm,
  OrderStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  AuditAction,
  NotificationType,
  ReviewStatus,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
  type IUser,
  type IPatientProfile,
  type IDoctorProfile,
  type IDoctorAvailability,
  type IWorkingShift,
  type IWeeklyScheduleDay,
  type IScheduleException,
  type IPharmacyProfile,
  type IAppointment,
  type IAppointmentCancellation,
  type IConsultation,
  type IMedicalRecord,
  type IPrescription,
  type IPrescriptionMedicineItem,
  type IAddress,
  type IEmergencyContact,
  type IVerificationDocument,
  type IMedicine,
  type IInventory,
  type IOrderItemSnapshot,
  type IOrderTotals,
  type IOrderPrescriptionReview,
  type IOrder,
  type IPayment,
  type IAuditLog,
  type INotification,
  type IReview,
  type IComplaintResolution,
  type IComplaint,
  type IRefreshToken,
} from "../types/models.js";

