import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { userRouter } from "./user.routes.js";
import { patientRouter } from "./patient.routes.js";
import { doctorRouter } from "./doctor.routes.js";
import { availabilityRouter } from "./availability.routes.js";
import { pharmacyRouter } from "./pharmacy.routes.js";
import { adminRouter } from "./admin.routes.js";
import { appointmentRouter } from "./appointment.routes.js";
import { paymentRouter } from "./payment.routes.js";
import { consultationRouter } from "./consultation.routes.js";
import { medicalRecordRouter } from "./medical-record.routes.js";
import { prescriptionRouter } from "./prescription.routes.js";
import { medicineRouter } from "./medicine.routes.js";
import { inventoryRouter } from "./inventory.routes.js";
import { orderRouter } from "./order.routes.js";
import { chatRouter } from "./chat.routes.js";

export const apiV1Router = Router();

// Mount auth router under /auth -> /api/v1/auth
apiV1Router.use("/auth", authRouter);

// Mount user router under /users -> /api/v1/users
apiV1Router.use("/users", userRouter);

// Mount patient router under /patients -> /api/v1/patients
apiV1Router.use("/patients", patientRouter);

// Mount doctor router under /doctors -> /api/v1/doctors
apiV1Router.use("/doctors", doctorRouter);

// Mount pharmacy router under /pharmacies -> /api/v1/pharmacies
apiV1Router.use("/pharmacies", pharmacyRouter);

// Mount admin router under /admin -> /api/v1/admin
apiV1Router.use("/admin", adminRouter);

// Mount appointment router under /appointments -> /api/v1/appointments
apiV1Router.use("/appointments", appointmentRouter);

// Mount payment router under /payments -> /api/v1/payments
apiV1Router.use("/payments", paymentRouter);

// Mount consultation router under /consultations -> /api/v1/consultations
apiV1Router.use("/consultations", consultationRouter);

// Mount medical-records router under /medical-records -> /api/v1/medical-records
apiV1Router.use("/medical-records", medicalRecordRouter);

// Mount prescription router under /prescriptions -> /api/v1/prescriptions
apiV1Router.use("/prescriptions", prescriptionRouter);

// Mount medicine router under /medicines -> /api/v1/medicines
apiV1Router.use("/medicines", medicineRouter);

// Mount order router under /orders -> /api/v1/orders
apiV1Router.use("/orders", orderRouter);

// Mount conversations router under /conversations -> /api/v1/conversations
apiV1Router.use("/conversations", chatRouter);

export {
  authRouter,
  userRouter,
  patientRouter,
  doctorRouter,
  availabilityRouter,
  pharmacyRouter,
  adminRouter,
  appointmentRouter,
  paymentRouter,
  consultationRouter,
  medicalRecordRouter,
  prescriptionRouter,
  medicineRouter,
  inventoryRouter,
  orderRouter,
  chatRouter,
};
