// Core Identity & Profile Models
export { User } from "./user.model.js";
export { PatientProfile } from "./patient-profile.model.js";
export { DoctorProfile } from "./doctor-profile.model.js";
export { PharmacyProfile } from "./pharmacy-profile.model.js";

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
  type IUser,
  type IPatientProfile,
  type IDoctorProfile,
  type IPharmacyProfile,
  type IAddress,
  type IEmergencyContact,
  type IVerificationDocument,
} from "../types/models.js";
