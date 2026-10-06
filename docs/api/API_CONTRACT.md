# LifeLine REST API Specification & Master Backend Contract

> **Document Version:** 1.0 — Phase 5 Baseline  
> **Source of Truth:** [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md)  
> **Architecture Pattern:** Modular Monolith REST API  
> **Base URL:** `/api/v1`  
> **Format:** JSON (`application/json`)  
> **Protocols:** HTTPS (REST) + WSS (Socket.IO Real-Time)

---

## 1. Global Conventions & Cross-Cutting Architecture

### 1.1 API Versioning
All public and internal endpoints are namespaced under `/api/v1`. Any future non-backward-compatible change will introduce `/api/v2`.

### 1.2 Idempotency Strategy
All state-mutating requests (`POST /api/v1/appointments`, `POST /api/v1/orders`, `POST /api/v1/payments/create-intent`) support an optional `Idempotency-Key` header (UUIDv4). The server caches idempotency keys in Redis or MongoDB for 24 hours to prevent duplicate transactions caused by network retries.

### 1.3 Pagination, Sorting, and Filtering Standard
All paginated list endpoints accept standard query parameters:
* `page`: 1-based index (default: `1`).
* `limit`: Items per page (default: `20`, max: `100`).
* `sort`: Field name to sort by (e.g. `createdAt`, `scheduledStart`, `rating`).
* `order`: Sort direction: `asc` or `desc` (default: `desc`).

#### Standard Paginated Response Meta
```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false,
    "timestamp": "2026-10-07T00:30:00.000Z"
  }
}
```

### 1.4 Rate Limiting Strategy
* **Standard Endpoints:** 100 requests per minute per IP.
* **Authentication Endpoints (`/api/v1/auth/*`):** 5 failed attempts per 15 minutes per IP/email.
* **AI Assistant Endpoints (`/api/v1/ai/*`):** 10 requests per minute per authenticated user.
* Headers returned on all requests:
  * `RateLimit-Limit`: Maximum allowable requests.
  * `RateLimit-Remaining`: Remaining request quota.
  * `RateLimit-Reset`: UTC epoch timestamp when the window resets.

### 1.5 Authentication Architecture (JWT + Refresh Tokens)
1. **Access Token**: Short-lived JWT (15-minute TTL) passed via `Authorization: Bearer <token>`.
2. **Refresh Token**: Long-lived JWT (7-day TTL) stored in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Secure-refresh_token`).
3. **Token Rotation**: Each refresh request invalidates the previous refresh token and issues a new pair. If a revoked refresh token is reused, the entire token family is invalidated to mitigate token theft.

---

## 2. Cross-Cutting Architectural Blueprints

### 2.1 Concurrency & Double-Booking Prevention Strategy
To ensure two patients never successfully book the same doctor at the same time:
1. **MongoDB Compound Unique Index**:
   ```javascript
   // Ensure only ONE active appointment exists per doctor per scheduled start
   db.appointments.createIndex(
     { doctorId: 1, scheduledStart: 1 },
     { 
       unique: true, 
       partialFilterExpression: { 
         status: { $in: ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS"] } 
       } 
     }
   );
   ```
2. **Two-Phase Slot Checkout**:
   * **Phase 1 (Lock):** When a patient clicks "Book Now", a temporary `PENDING_PAYMENT` document is inserted atomically using a conditional query. If the unique index or condition fails, MongoDB throws `E11000 duplicate key error`, instantly returning `APPOINTMENT_SLOT_UNAVAILABLE` (HTTP 409).
   * **Phase 2 (Confirm):** A background worker releases locks after 15 minutes if payment is not confirmed. Upon server-side payment verification, the status updates atomically to `CONFIRMED`.

### 2.2 Payment Webhook & Backend Verification Flow
1. Patient initiates checkout -> Backend creates gateway order via Stripe/Razorpay SDK.
2. Gateway returns `providerOrderId`.
3. Patient completes payment on client modal -> Gateway emits asynchronous webhook to `POST /api/v1/payments/webhook`.
4. **Backend Webhook Verification**:
   * Extracts raw request body and cryptographic signature header (`Stripe-Signature` or `X-Razorpay-Signature`).
   * Computes HMAC SHA-256 against server's `WEBHOOK_SECRET`.
   * **If invalid:** Rejects with HTTP 401.
   * **If valid:** Performs atomic MongoDB transaction:
     * Check if payment transaction already processed (idempotency).
     * Update `Payment` status to `SUCCESS`.
     * Update parent `Appointment` to `CONFIRMED` or `Order` to `PLACED`.
     * Emits real-time event via Socket.IO to notify patient and doctor/pharmacy.

### 2.3 Video Consultation Lifecycle
1. Attending Doctor calls `POST /api/v1/consultations/:appointmentId/session` at appointment time.
2. Backend validates that current time is within `scheduledStart - 5 minutes` and caller is the assigned doctor.
3. Backend contacts managed video infrastructure (e.g. Daily.co / Twilio Video / LiveKit) to create an isolated video room.
4. Backend generates short-lived room tokens (expiring in 60 minutes) for Doctor and Patient.
5. Patient calls `GET /api/v1/consultations/:id/token` to receive their participant token.
6. When call ends, Doctor submits clinical notes -> consultation marked `COMPLETED`.

### 2.4 AI Healthcare Assistant Isolation Blueprint
1. AI service is strictly isolated in `server/src/integrations/ai/` and wrapped by `server/src/services/ai.service.ts`.
2. **System Prompt Guardrails**:
   * The AI MUST explicitly state: *"I am an AI assistant and cannot provide medical diagnoses or prescribe treatment. Please consult a qualified doctor for clinical decisions."*
   * Refuses requests attempting automated self-diagnosis of emergency symptoms (e.g. chest pain, stroke symptoms), advising immediate emergency care.
   * Redacts sensitive identifiable medical data before sending prompts to third-party LLMs.

---

## 3. Comprehensive Endpoint Catalog

---

### Group 1: Authentication (`/api/v1/auth`)

#### 1.1 `POST /api/v1/auth/register`
* **Purpose:** Register a new user account with role-specific base details.
* **Auth Requirement:** Public (`None`).
* **Rate Limit:** 5 requests / min per IP.
* **Request Body:**
  ```json
  {
    "email": "sarah.jenkins@example.com",
    "password": "SecurePassword123!",
    "role": "DOCTOR",
    "fullName": "Dr. Sarah Jenkins",
    "phone": "+15551234567"
  }
  ```
* **Zod Schema:**
  ```typescript
  z.object({
    email: z.string().email(),
    password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
    role: z.enum(["PATIENT", "DOCTOR", "PHARMACY"]),
    fullName: z.string().min(2).max(100),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/)
  })
  ```
* **Business Rules:** Role `ADMIN` cannot be self-registered. Email and phone must be unique across `users` collection.
* **Database Operations:** Insert `User` document; create corresponding unverified/skeleton profile (`PatientProfile`, `DoctorProfile`, or `PharmacyProfile`).
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "userId": "usr_6702e1c9a1",
      "email": "sarah.jenkins@example.com",
      "role": "DOCTOR",
      "status": "PENDING_VERIFICATION"
    },
    "message": "Registration successful. Please verify your email."
  }
  ```
* **Error Codes:** `AUTH_EMAIL_ALREADY_EXISTS` (409), `AUTH_PHONE_ALREADY_EXISTS` (409), `VALIDATION_ERROR` (422).
* **Side Effects / Events:** Emit email verification token; send verification email.
* **Audit Log:** `ACTION: USER_REGISTERED`.
* **Testing:** Test duplicate emails, invalid passwords, valid user creation for each allowed role.

---

#### 1.2 `POST /api/v1/auth/login`
* **Purpose:** Authenticate user and issue JWT access token and refresh cookie.
* **Auth Requirement:** Public (`None`).
* **Rate Limit:** 5 failed attempts / 15 min per IP.
* **Request Body:**
  ```json
  {
    "email": "sarah.jenkins@example.com",
    "password": "SecurePassword123!"
  }
  ```
* **Business Rules:** Compare password hash using `bcrypt`. If account status is `SUSPENDED`, reject with `AUTH_ACCOUNT_SUSPENDED`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5c...",
      "user": {
        "id": "usr_6702e1c9a1",
        "email": "sarah.jenkins@example.com",
        "role": "DOCTOR",
        "fullName": "Dr. Sarah Jenkins"
      }
    },
    "message": "Login successful"
  }
  ```
  *Sets `HttpOnly` cookie: `__Secure-refresh_token`.*
* **Error Codes:** `AUTH_INVALID_CREDENTIALS` (401), `AUTH_ACCOUNT_SUSPENDED` (403).
* **Audit Log:** `ACTION: USER_LOGIN_SUCCESS` or `ACTION: USER_LOGIN_FAILED`.

---

#### 1.3 `POST /api/v1/auth/refresh-token`
* **Purpose:** Refresh expired access token using the HttpOnly refresh token.
* **Auth Requirement:** Refresh Cookie.
* **Business Rules:** Rotate refresh token on each call. If reused token detected, revoke entire token family.
* **Success Response (200 OK):** Returns new `accessToken` and sets rotated refresh cookie.
* **Error Codes:** `AUTH_REFRESH_TOKEN_EXPIRED` (401), `AUTH_REFRESH_TOKEN_REVOKED` (401).

---

#### 1.4 `POST /api/v1/auth/logout`
* **Purpose:** Invalidate refresh token and clear cookies.
* **Auth Requirement:** Authenticated (Any role).
* **Success Response (200 OK):** `{ "success": true, "message": "Logged out successfully" }`.

---

### Group 2: Users (`/api/v1/users`)

#### 2.1 `GET /api/v1/users/me`
* **Purpose:** Retrieve authenticated user profile and account state.
* **Auth Requirement:** Authenticated (Any role).
* **Success Response (200 OK):** Returns base `User` entity and linked profile (`PatientProfile`, `DoctorProfile`, or `PharmacyProfile`).

#### 2.2 `PATCH /api/v1/users/me`
* **Purpose:** Update user contact details (phone, avatar).
* **Auth Requirement:** Authenticated.
* **Validation:** Phone format, valid image URL.
* **Success Response (200 OK):** Updated user object.

---

### Group 3: Patients (`/api/v1/patients`)

#### 3.1 `GET /api/v1/patients/me/profile`
* **Purpose:** Retrieve patient health profile (blood group, allergies, emergency contacts).
* **Auth Requirement:** Role `PATIENT`.

#### 3.2 `PUT /api/v1/patients/me/profile`
* **Purpose:** Update personal medical history, chronic conditions, and emergency contacts.
* **Auth Requirement:** Role `PATIENT` (Own profile only).
* **Zod Schema:**
  ```typescript
  z.object({
    dateOfBirth: z.string().datetime(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
    allergies: z.array(z.string()).default([]),
    medicalConditions: z.array(z.string()).default([]),
    currentMedications: z.array(z.string()).default([]),
    emergencyContact: z.object({
      name: z.string(),
      relationship: z.string(),
      phone: z.string()
    }).optional()
  })
  ```
* **Success Response (200 OK):** Updated `PatientProfile`.

---

### Group 4: Doctors (`/api/v1/doctors`)

#### 4.1 `GET /api/v1/doctors` (Public Discovery & Search)
* **Purpose:** Search and filter verified doctors.
* **Auth Requirement:** Public (`None`).
* **Query Parameters:**
  * `search`: String (searches doctor name, clinic name).
  * `specialization`: Enum (e.g. `CARDIOLOGY`, `DERMATOLOGY`, `PEDIATRICS`, `GENERAL_PHYSICIAN`).
  * `location`: String (city, postal code).
  * `minExperience`: Number.
  * `maxFee`: Number.
  * `minRating`: Number (e.g. `4.0`).
  * `page`, `limit`, `sort`, `order`.
* **Business Rules:** ONLY returns doctors with `verificationStatus === 'VERIFIED'` and `status === 'ACTIVE'`.
* **Database Operations:** Indexed MongoDB search with compound filter on `specialization`, `location`, `rating`.
* **Success Response (200 OK):** Paginated array of Doctor summary cards.

---

#### 4.2 `GET /api/v1/doctors/:id`
* **Purpose:** View comprehensive public doctor profile.
* **Auth Requirement:** Public (`None`).
* **Success Response (200 OK):** Doctor profile including qualifications, languages, consultation fee, rating statistics, and available days.

---

#### 4.3 `POST /api/v1/doctors/me/verification-documents`
* **Purpose:** Doctor uploads medical registration license, degrees, and government ID for admin review.
* **Auth Requirement:** Role `DOCTOR`.
* **Zod Schema:**
  ```typescript
  z.object({
    registrationNumber: z.string().min(5),
    registrationCouncil: z.string().min(3),
    qualifications: z.array(z.string()).min(1),
    documents: z.array(z.object({
      documentType: z.enum(["MEDICAL_LICENSE", "DEGREE_CERTIFICATE", "GOVERNMENT_ID"]),
      fileKey: z.string()
    })).min(1)
  })
  ```
* **Business Rules:** Moves doctor verification state from `UNSUBMITTED` or `INFO_REQUESTED` to `PENDING_REVIEW`.
* **Success Response (200 OK):** `{ "success": true, "status": "PENDING_REVIEW" }`.
* **Side Effects:** Enqueue in Admin verification dashboard; emit notification to admin.

---

### Group 5: Doctor Availability (`/api/v1/doctors/:id/availability`)

#### 5.1 `GET /api/v1/doctors/:id/availability`
* **Purpose:** Retrieve available bookable time slots for a specific doctor on a target date.
* **Auth Requirement:** Public (`None`).
* **Query Parameters:** `date` (YYYY-MM-DD format).
* **Business Rules:** Computes available slots by evaluating doctor weekly recurring schedule, subtracting blocked exceptions/holidays, and subtracting already booked or locked appointments.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "doctorId": "doc_6702e1c9a1",
      "date": "2026-10-15",
      "slots": [
        { "startTime": "09:00", "endTime": "09:30", "available": true },
        { "startTime": "09:30", "endTime": "10:00", "available": false },
        { "startTime": "10:00", "endTime": "10:30", "available": true }
      ]
    }
  }
  ```

---

#### 5.2 `PUT /api/v1/doctors/me/availability`
* **Purpose:** Doctor configures recurring weekly working hours and slot durations.
* **Auth Requirement:** Role `DOCTOR` (`VERIFIED`).
* **Zod Schema:**
  ```typescript
  z.object({
    slotDurationMinutes: z.enum([15, 20, 30, 45, 60]),
    weeklySchedule: z.array(z.object({
      dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
      shifts: z.array(z.object({
        startTime: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/)
      }))
    }))
  })
  ```
* **Success Response (200 OK):** Updated schedule confirmation.

---

### Group 6: Appointments (`/api/v1/appointments`)

#### 6.1 `POST /api/v1/appointments` (Slot Reservation & Intent)
* **Purpose:** Book an appointment slot and establish a 15-minute concurrency lock.
* **Auth Requirement:** Role `PATIENT`.
* **Headers:** `Idempotency-Key` (UUIDv4).
* **Zod Schema:**
  ```typescript
  z.object({
    doctorId: z.string(),
    appointmentType: z.enum(["VIDEO", "AUDIO", "CHAT", "IN_PERSON"]),
    scheduledStart: z.string().datetime(),
    reason: z.string().min(5).max(500)
  })
  ```
* **Business Rules:**
  * Double-booking check: Must acquire atomic lock on `(doctorId, scheduledStart)`.
  * If slot is taken, immediately return `APPOINTMENT_SLOT_UNAVAILABLE` (409).
  * Doctor must be verified.
* **Database Operations:** Atomic insert into `appointments` with status `PENDING_PAYMENT` and lock expiration timestamp (`Date.now() + 15 * 60 * 1000`).
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "appointmentId": "apt_89ab32c10",
      "status": "PENDING_PAYMENT",
      "expiresAt": "2026-10-07T00:45:00.000Z",
      "fee": 50.00,
      "currency": "USD"
    },
    "message": "Slot reserved for 15 minutes. Please complete payment."
  }
  ```
* **Error Codes:** `APPOINTMENT_SLOT_UNAVAILABLE` (409), `DOCTOR_NOT_VERIFIED` (403), `APPOINTMENT_PAST_DATE` (422).

---

#### 6.2 `GET /api/v1/appointments`
* **Purpose:** List user's appointments.
* **Auth Requirement:** Role `PATIENT` (own appointments), `DOCTOR` (assigned appointments), `ADMIN` (all).
* **Query Parameters:** `status`, `from`, `to`, `page`, `limit`.

---

#### 6.3 `PATCH /api/v1/appointments/:id/cancel`
* **Purpose:** Cancel a scheduled appointment.
* **Auth Requirement:** Role `PATIENT` (owner), `DOCTOR` (assigned), `ADMIN`.
* **Zod Schema:**
  ```typescript
  z.object({
    cancellationReason: z.string().min(5)
  })
  ```
* **Business Rules:** Patient cannot cancel within 2 hours of appointment start. Full automated refund triggered if cancelled >2h prior.
* **Success Response (200 OK):** Appointment status updated to `CANCELLED`.
* **Side Effects:** Free calendar slot; trigger payment refund; emit `APPOINTMENT_CANCELLED` via Socket.IO.

---

### Group 7: Consultations (`/api/v1/consultations`)

#### 7.1 `POST /api/v1/consultations/:appointmentId/session`
* **Purpose:** Doctor starts virtual room session.
* **Auth Requirement:** Role `DOCTOR` (Assigned doctor only).
* **Business Rules:** Permitted only within `scheduledStart - 5 minutes` to `scheduledEnd`.
* **Success Response (200 OK):** Returns `consultationId`, `roomUrl`, and doctor's room auth token.
* **Side Effects:** Emit `ROOM_READY` event to Patient socket.

#### 7.2 `GET /api/v1/consultations/:id/token`
* **Purpose:** Participant retrieves temporary token to enter active video room.
* **Auth Requirement:** Role `PATIENT` or `DOCTOR` (Verified appointment participants).
* **Success Response (200 OK):** `{ "token": "vid_tok_...", "expiresInSeconds": 3600 }`.

#### 7.3 `POST /api/v1/consultations/:id/notes`
* **Purpose:** Doctor finalizes clinical consultation notes and diagnosis.
* **Auth Requirement:** Role `DOCTOR`.
* **Zod Schema:**
  ```typescript
  z.object({
    diagnosis: z.string().min(3),
    clinicalNotes: z.string().min(5),
    recommendedFollowUpDays: z.number().optional()
  })
  ```
* **Success Response (200 OK):** Consultation marked `COMPLETED`; unlocks prescription issuance.

---

### Group 8: Medical Records (`/api/v1/medical-records`)

#### 8.1 `POST /api/v1/medical-records/upload-url`
* **Purpose:** Request secure pre-signed object storage upload URL.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    fileName: z.string(),
    fileType: z.enum(["application/pdf", "image/png", "image/jpeg", "application/dicom"]),
    sizeBytes: z.number().max(15728640) // 15 MB
  })
  ```
* **Success Response (200 OK):** Returns S3/GCS pre-signed PUT URL with 10-minute expiration.

#### 8.2 `POST /api/v1/medical-records`
* **Purpose:** Register medical record metadata after successful object upload.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    title: z.string().min(3),
    recordType: z.enum(["LAB_REPORT", "PRESCRIPTION", "XRAY", "MRI", "CT_SCAN", "OTHER"]),
    storageKey: z.string(),
    recordDate: z.string().datetime(),
    relatedAppointmentId: z.string().optional()
  })
  ```
* **Success Response (201 Created):** Created `MedicalRecord` metadata document.

#### 8.3 `GET /api/v1/medical-records/:id/download-url`
* **Purpose:** Generate expiring signed download URL.
* **Auth Requirement:** Role `PATIENT` (owner), `DOCTOR` (active clinical relationship), `ADMIN`.
* **Business Rules:** Logged in Audit Log (`ACTION: MEDICAL_RECORD_ACCESSED`). URL valid for exactly 15 minutes.

---

### Group 9: Prescriptions (`/api/v1/prescriptions`)

#### 9.1 `POST /api/v1/prescriptions`
* **Purpose:** Doctor issues an immutable digital prescription.
* **Auth Requirement:** Role `DOCTOR` (`VERIFIED`).
* **Zod Schema:**
  ```typescript
  z.object({
    patientId: z.string(),
    appointmentId: z.string(),
    diagnosis: z.string().min(3),
    medicines: z.array(z.object({
      medicineId: z.string(),
      medicineName: z.string(),
      dosage: z.string(),       // e.g. "500mg"
      frequency: z.string(),    // e.g. "1-0-1 (After food)"
      durationDays: z.number().min(1),
      route: z.enum(["ORAL", "TOPICAL", "INJECTION", "DROPS", "INHALATION"]).default("ORAL"),
      specialInstructions: z.string().optional()
    })).min(1),
    additionalNotes: z.string().optional()
  })
  ```
* **Business Rules:** Attending doctor only. Once issued, status is `FINALIZED_ISSUED` and cannot be modified. Takes snapshot of medicine names.
* **Success Response (201 Created):** Created `Prescription` document with cryptographic issue timestamp.
* **Side Effects:** Emit `PRESCRIPTION_ISSUED` to patient socket; trigger notification.

---

### Group 10: Medicines Catalog (`/api/v1/medicines`)

#### 10.1 `GET /api/v1/medicines` (Public Catalog Search)
* **Purpose:** Search global medicine catalog.
* **Auth Requirement:** Public (`None`).
* **Query Parameters:** `search`, `category`, `dosageForm`, `prescriptionRequired`, `page`, `limit`.

#### 10.2 `POST /api/v1/medicines`
* **Purpose:** Add new master drug to catalog.
* **Auth Requirement:** Role `ADMIN`.
* **Validation:** Name, generic chemical name, manufacturer, dosage form, prescription requirement flag.

---

### Group 11: Pharmacies & Inventory (`/api/v1/pharmacies`)

#### 11.1 `GET /api/v1/pharmacies`
* **Purpose:** Browse verified pharmacies.
* **Auth Requirement:** Public.
* **Query Parameters:** `location`, `deliveryAvailable`, `page`, `limit`.

#### 11.2 `GET /api/v1/pharmacies/:id/inventory`
* **Purpose:** Check medicine availability and stock at a target pharmacy.
* **Auth Requirement:** Public.

#### 11.3 `PATCH /api/v1/pharmacies/me/inventory/:inventoryId`
* **Purpose:** Pharmacy updates stock quantity, unit price, batch number, and expiry date.
* **Auth Requirement:** Role `PHARMACY` (`VERIFIED`).
* **Zod Schema:**
  ```typescript
  z.object({
    quantity: z.number().min(0),
    price: z.number().min(0.01),
    batchNumber: z.string().optional(),
    expiryDate: z.string().datetime().optional()
  })
  ```

---

### Group 12: Medicine Orders (`/api/v1/orders`)

#### 12.1 `POST /api/v1/orders`
* **Purpose:** Patient places order for medicines from a specific pharmacy.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    pharmacyId: z.string(),
    items: z.array(z.object({
      medicineId: z.string(),
      quantity: z.number().min(1)
    })).min(1),
    deliveryAddress: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string()
    }),
    prescriptionId: z.string().optional()
  })
  ```
* **Business Rules:**
  * If ANY item requires a prescription, `prescriptionId` is mandatory and must match the ordering patient.
  * Price and medicine name snapshots recorded at time of order creation.
  * Stock atomically reserved.
* **Success Response (201 Created):** Created `Order` with status `PLACED` or `PRESCRIPTION_REVIEW`.

---

#### 12.2 `PATCH /api/v1/orders/:id/prescription-review`
* **Purpose:** Pharmacist approves or rejects attached prescription.
* **Auth Requirement:** Role `PHARMACY` (Assigned pharmacy).
* **Zod Schema:**
  ```typescript
  z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().optional()
  })
  ```
* **Business Rules:** If rejected, automated payment refund initiated and reserved stock released.

---

#### 12.3 `PATCH /api/v1/orders/:id/status`
* **Purpose:** Update order delivery state.
* **Auth Requirement:** Role `PHARMACY`, `ADMIN`.
* **Zod Schema:**
  ```typescript
  z.object({
    status: z.enum(["PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"])
  })
  ```
* **Business Rules:** Follows Order State Machine transitions strictly. `DELIVERED` requires verification OTP.

---

### Group 13: Payments (`/api/v1/payments`)

#### 13.1 `POST /api/v1/payments/create-intent`
* **Purpose:** Initialize payment order with payment gateway.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    targetType: z.enum(["APPOINTMENT", "ORDER"]),
    targetId: z.string()
  })
  ```
* **Business Rules:** Verifies target entity belongs to caller and is in `PENDING_PAYMENT` state.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "paymentId": "pay_6702e1c9a1",
      "provider": "STRIPE",
      "clientSecret": "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrkjWevpXTmdtuWeoPpR",
      "amount": 50.00,
      "currency": "USD"
    }
  }
  ```

---

#### 13.2 `POST /api/v1/payments/webhook`
* **Purpose:** Gateway webhook callback for real-time capture and refund events.
* **Auth Requirement:** Cryptographic Signature Verification (`Stripe-Signature` or `X-Razorpay-Signature`).
* **Business Rules:** Strict server-side verification; idempotent updates; triggers entity confirmation.

---

### Group 14: Notifications (`/api/v1/notifications`)

#### 14.1 `GET /api/v1/notifications`
* **Purpose:** List user's notifications.
* **Auth Requirement:** Authenticated (Any role).
* **Query Parameters:** `unreadOnly` (boolean), `page`, `limit`.

#### 14.2 `PATCH /api/v1/notifications/:id/read`
* **Purpose:** Mark notification as read.
* **Auth Requirement:** Owner only.

---

### Group 15: Messages & Chat (`/api/v1/conversations`, `/api/v1/messages`)

#### 15.1 `GET /api/v1/conversations`
* **Purpose:** Retrieve active consultation chats for the user.
* **Auth Requirement:** Role `PATIENT` or `DOCTOR`.

#### 15.2 `GET /api/v1/conversations/:id/messages`
* **Purpose:** Retrieve paginated chat history.
* **Auth Requirement:** Participant only.

---

### Group 16: Reviews (`/api/v1/reviews`)

#### 16.1 `POST /api/v1/reviews`
* **Purpose:** Patient reviews a doctor following a completed appointment.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    appointmentId: z.string(),
    doctorId: z.string(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(5).max(1000)
  })
  ```
* **Business Rules:** Backend enforces that `appointment.status === 'COMPLETED'`, `appointment.patientId === req.user.id`, and that no previous review exists for this appointment.
* **Side Effects:** Recalculates doctor aggregate rating and review count.

---

### Group 17: Complaints & Disputes (`/api/v1/complaints`)

#### 17.1 `POST /api/v1/complaints`
* **Purpose:** Submit platform dispute or service complaint.
* **Auth Requirement:** Authenticated (Any role).
* **Zod Schema:**
  ```typescript
  z.object({
    category: z.enum(["APPOINTMENT", "DOCTOR_CONDUCT", "MEDICINE_QUALITY", "DELIVERY", "PAYMENT", "OTHER"]),
    relatedId: z.string().optional(),
    description: z.string().min(10)
  })
  ```

#### 17.2 `PATCH /api/v1/complaints/:id/resolve`
* **Purpose:** Admin resolves complaint with resolution notes.
* **Auth Requirement:** Role `ADMIN`.

---

### Group 18: Admin Operations (`/api/v1/admin`)

#### 18.1 `GET /api/v1/admin/users`
* **Purpose:** Search and manage platform users.
* **Auth Requirement:** Role `ADMIN`.

#### 18.2 `PATCH /api/v1/admin/users/:id/status`
* **Purpose:** Suspend, reinstate, or deactivate a user account.
* **Auth Requirement:** Role `ADMIN`.
* **Audit Log:** Mandatory.

#### 18.3 `PATCH /api/v1/admin/doctors/:id/verify`
* **Purpose:** Approve or reject doctor credentials.
* **Auth Requirement:** Role `ADMIN`.
* **Zod Schema:**
  ```typescript
  z.object({
    status: z.enum(["APPROVED_VERIFIED", "REJECTED", "INFO_REQUESTED"]),
    reviewNotes: z.string().min(5)
  })
  ```
* **Audit Log:** Mandatory (`ACTION: DOCTOR_VERIFICATION_APPROVED`).

#### 18.4 `GET /api/v1/admin/audit-logs`
* **Purpose:** Query system audit trail.
* **Auth Requirement:** Role `ADMIN`.
* **Query Parameters:** `actorId`, `action`, `resourceType`, `from`, `to`, `page`, `limit`.

---

### Group 19: Analytics (`/api/v1/analytics`)

#### 19.1 `GET /api/v1/analytics/admin/overview`
* **Purpose:** High-level platform health metrics (appointments count, completed orders, gross transaction volume, active users).
* **Auth Requirement:** Role `ADMIN`.

#### 19.2 `GET /api/v1/analytics/doctor/earnings`
* **Purpose:** Doctor earnings breakdown, completed consultations, pending payouts.
* **Auth Requirement:** Role `DOCTOR`.

---

### Group 20: AI Healthcare Assistant (`/api/v1/ai`)

#### 20.1 `POST /api/v1/ai/assistant/chat`
* **Purpose:** Safe non-diagnostic healthcare navigation and query assistant.
* **Auth Requirement:** Role `PATIENT`, `DOCTOR`.
* **Rate Limit:** 10 requests / min.
* **Zod Schema:**
  ```typescript
  z.object({
    query: z.string().min(2).max(1000)
  })
  ```
* **Business Rules:** Sanitized against prompt injection and emergency diagnostic requests. Pre-pends non-diagnostic safety guardrail.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "response": "Cardiologists specialize in diagnosing and treating diseases of the heart and blood vessels...",
      "disclaimer": "This information is educational and does not constitute medical advice.",
      "suggestedSpecialists": ["CARDIOLOGY"]
    }
  }
  ```

#### 20.2 `POST /api/v1/ai/assistant/explain-terms`
* **Purpose:** Explains medical jargon from records/prescriptions in plain layman language.
* **Auth Requirement:** Role `PATIENT`.
* **Zod Schema:**
  ```typescript
  z.object({
    term: z.string().min(2).max(100)
  })
  ```
