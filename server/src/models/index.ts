// Core Identity & Profile Models
export { User } from "./user.model.js";
export { PatientProfile } from "./patient-profile.model.js";
export { DoctorProfile } from "./doctor-profile.model.js";
export { PharmacyProfile } from "./pharmacy-profile.model.js";

// Clinical & Appointment Models
export { Appointment } from "./appointment.model.js";
export { Consultation } from "./consultation.model.js";
export { MedicalRecord } from "./medical-record.model.js";
export { Prescription } from "./prescription.model.js";

// Plugins
export { toJSONPlugin } from "./plugins/index.js";

// Re-export shared domain enums & types
export {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  Gender,
  BloodGroup,
  ConsultationType,
  AppointmentStatus,
  ConsultationStatus,
  MedicalRecordType,
  PrescriptionStatus,
  MedicineRoute,
  type IUser,
  type IPatientProfile,
  type IDoctorProfile,
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
} from "../types/models.js";
