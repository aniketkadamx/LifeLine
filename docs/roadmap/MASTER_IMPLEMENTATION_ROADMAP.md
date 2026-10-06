# LifeLine Master Implementation Roadmap

> **Document Version:** 1.0 — Phase 6 Baseline  
> **Source of Truth:** [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md), [`docs/api/API_CONTRACT.md`](../api/API_CONTRACT.md), [`docs/api/STATE_MACHINES.md`](../api/STATE_MACHINES.md), [`docs/api/AUTHORIZATION_MATRIX.md`](../api/AUTHORIZATION_MATRIX.md), [`docs/api/ERROR_TAXONOMY.md`](../api/ERROR_TAXONOMY.md)  
> **Architecture Pattern:** Modular Monolith (Client-Server Separation)  
> **Development Strategy:** Incremental, Test-Driven Vertical Slices with Git Checkpoints

---

## 1. Roadmap Architecture & Execution Philosophy

This roadmap translates the system contracts into sequential, safe, testable, and reviewable implementation tasks.

### Core Principles
1. **Vertical Slices Over Horizontal Layers:** We implement thin, end-to-end capabilities rather than writing all database schemas or all routes at once.
2. **Contract Preservation:** Implementation must strictly adhere to the contracts defined in Phase 5 without silent deviation.
3. **Layered Context Protection:** Each implementation task receives only its specific slice of context to prevent LLM hallucinations, token bloat, or unintended code modifications.
4. **Git Checkpointing:** Every individual task concludes with passing automated tests and a clean Git commit.
5. **Human-in-the-Loop Learning:** For every step, the rationale, security checks, and code review criteria are explicitly detailed so the developer learns how professional systems are architected.

---

## 2. Approved Technical Decisions Reference

* **Payment Gateway:** Razorpay (server-side cryptographic webhook verification via HMAC SHA-256).
* **Video Consultation Provider:** LiveKit Cloud (managed WebRTC infrastructure with server-generated access tokens).
* **Prescription Validity Window:** 90 calendar days from cryptographic issuance.
* **Appointment Cancellation / Refund Window:** Minimum 2 hours prior to scheduled start time.

---

## 3. Milestone Overview

| Milestone | Scope / Domain | Core Focus |
|:---|:---|:---|
| **M0** | Baseline & Configuration Hardening | Monorepo setup, type-safe environment validation, Docker services. |
| **M1** | Database Architecture & Data Access | MongoDB connection lifecycle, Mongoose schemas, compound unique indexes. |
| **M2** | Backend Core Pipeline & Middlewares | Express pipeline, error envelope, security headers, audit log service. |
| **M3** | Authentication & Identity | JWT access + HttpOnly refresh token rotation, password hashing, session revocation. |
| **M4** | RBAC Authorization & Profiles | Role-based & ownership guards, Patient, Doctor, and Pharmacy profiles. |
| **M5** | Doctor Discovery & Availability Scheduling | Geocoded search, weekly recurring schedules, atomic slot computation. |
| **M6** | Appointments & Concurrency Protection | Two-phase checkout, atomic lock, 15-min expiry, cancellation/rescheduling. |
| **M7** | Razorpay Payment Integration | Payment intent, webhook verification, ledger updates, automated refunds. |
| **M8** | Virtual Consultation & LiveKit | Room session management, expiring LiveKit tokens, clinical notes. |
| **M9** | Medical Records & Digital Prescriptions | Secure object storage pre-signed URLs, immutable prescriptions, PDF engine. |
| **M10** | Pharmacy, Medicines & Order Fulfillment | Master catalog, pharmacy inventory, Rx review queue, delivery tracking. |
| **M11** | Real-Time Sockets, Chat & Notifications | Authenticated Socket.IO, consultation chat rooms, multi-channel alerts. |
| **M12** | Reviews, Complaints, Analytics & AI | Anti-fraud reviews, disputes, financial analytics, non-diagnostic AI service. |
| **M13** | Complete Frontend UI Integration | Design system tokens, role dashboards, booking wizard, LiveKit video UI. |
| **M14** | Testing, Security Hardening & Optimization | Vitest integration, Playwright E2E flows, OWASP audit, query profiling. |
| **M15** | CI/CD, Deployment & Final Polish | GitHub Actions, Render/Vercel deployment, Sentry observability, demo script. |

---

## 4. Detailed Implementation Tasks

---

### Milestone 0: Baseline & Configuration Hardening

#### Task 0.1: Type-Safe Environment Management & Config Validation
* **Milestone:** M0 | **Phase:** 1 | **Feature:** Foundation | **Sub-Feature:** Configuration
* **Dependencies:** None
* **Files Changed:**
  * `server/src/config/env.ts` (New)
  * `server/src/config/index.ts` (New)
  * `server/.env.example` (Update)
* **Impact:** Backend configuration.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement Zod-based environment variable parsing in `server/src/config/env.ts` that validates `PORT`, `NODE_ENV`, `CLIENT_URL`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Must fail fast on startup if required variables are missing.
* **Manual Actions:** Provide local dummy credentials in `server/.env`.
* **Tests Required:** Unit tests verifying valid config loads and invalid config throws an informative startup exception.
* **Security Checks:** Zero secrets committed to Git; secrets must never be logged in plain text.
* **Code Review Checklist:** All environment variables typed; default values provided only for non-sensitive dev settings.
* **Git Branch / Checkpoint:** `git checkout -b feat/m0-config-validation` $\rightarrow$ `chore(config): add zod-based environment validation`
* **Expected Result:** Server startup crashes immediately with explicit messages if any mandatory environment variable is absent.
* **Rollback Approach:** Revert branch to initial commit.
* **Learning Rationale:** Prevents subtle runtime failures in production caused by missing or misnamed environment variables.

---

### Milestone 1: Database Architecture & Core Models

#### Task 1.1: MongoDB Connection Lifecycle & Base Schema Plugins
* **Milestone:** M1 | **Phase:** 2 | **Feature:** Database | **Sub-Feature:** Connection
* **Dependencies:** Task 0.1
* **Files Changed:**
  * `server/src/config/database.ts` (New)
  * `server/src/models/plugins/toJSON.plugin.ts` (New)
* **Impact:** Backend database connectivity.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build MongoDB connection manager with auto-reconnect, connection pooling, graceful shutdown handlers, and a `toJSON` plugin that strips `__v` and transforms `_id` to string `id`.
* **Manual Actions:** Ensure local MongoDB instance or MongoDB Atlas URI is accessible.
* **Tests Required:** Integration test verifying connection success, error handling on invalid URI, and graceful disconnect on `SIGINT`.
* **Security Checks:** Connection strings must not be logged.
* **Code Review Checklist:** Mongoose event listeners (`connected`, `error`, `disconnected`) implemented properly.
* **Git Branch / Checkpoint:** `feat/m1-db-connection` $\rightarrow$ `feat(database): configure mongoose connection lifecycle and plugins`
* **Expected Result:** Database cleanly connects and disconnects without leaking handles.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Clean connection handling prevents socket exhaustion and zombie database connections during deployments.

---

#### Task 1.2: Identity & Profile Mongoose Models (`User`, `PatientProfile`, `DoctorProfile`, `PharmacyProfile`)
* **Milestone:** M1 | **Phase:** 2 | **Feature:** Database | **Sub-Feature:** Identity Models
* **Dependencies:** Task 1.1
* **Files Changed:**
  * `server/src/models/user.model.ts` (New)
  * `server/src/models/patient-profile.model.ts` (New)
  * `server/src/models/doctor-profile.model.ts` (New)
  * `server/src/models/pharmacy-profile.model.ts` (New)
  * `server/src/types/models.ts` (New)
* **Impact:** Database schemas.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create Mongoose schemas matching the types in `docs/api/API_CONTRACT.md`. Enforce unique index on `User.email`, `User.phone`, and `DoctorProfile.registrationNumber`. Add geospatial index on `DoctorProfile.location` and `PharmacyProfile.location`.
* **Manual Actions:** None.
* **Tests Required:** Schema validation tests: duplicate email rejection, invalid phone format rejection, default status assignments.
* **Security Checks:** `passwordHash` field has `{ select: false }` to prevent accidental leak in queries.
* **Code Review Checklist:** Proper references (`ref: 'User'`) used; timestamps enabled.
* **Git Branch / Checkpoint:** `feat/m1-identity-models` $\rightarrow$ `feat(models): create user, patient, doctor, and pharmacy mongoose schemas`
* **Expected Result:** Mongoose compiles schemas and enforces database constraints.
* **Rollback Approach:** Remove model files.
* **Learning Rationale:** Decoupling the base `User` entity from domain profiles allows multiple roles while keeping authentication compact and fast.

---

#### Task 1.3: Clinical & Appointment Mongoose Models (`Appointment`, `Consultation`, `MedicalRecord`, `Prescription`)
* **Milestone:** M1 | **Phase:** 2 | **Feature:** Database | **Sub-Feature:** Clinical Models
* **Dependencies:** Task 1.2
* **Files Changed:**
  * `server/src/models/appointment.model.ts` (New)
  * `server/src/models/consultation.model.ts` (New)
  * `server/src/models/medical-record.model.ts` (New)
  * `server/src/models/prescription.model.ts` (New)
* **Impact:** Database schemas.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement clinical schemas. Crucial: add partial unique compound index `{ doctorId: 1, scheduledStart: 1 }` filtered on active statuses (`PENDING_PAYMENT`, `CONFIRMED`, `IN_PROGRESS`) in `Appointment`. Embed immutable medication item snapshots in `Prescription`.
* **Manual Actions:** None.
* **Tests Required:** Test double-booking index prevents duplicate active appointment on identical doctor/slot.
* **Security Checks:** No PHI stored unencrypted in plain text where strict compliance applies; storage keys only, no public URLs.
* **Code Review Checklist:** Compound unique index correctly configured with partial filter expression.
* **Git Branch / Checkpoint:** `feat/m1-clinical-models` $\rightarrow$ `feat(models): create appointment, consultation, record, and prescription schemas with concurrency index`
* **Expected Result:** Database prevents overlapping appointments at the engine level.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Demonstrates how database-level constraints guarantee concurrency safety even under heavy distributed race conditions.

---

#### Task 1.4: Commerce & Operational Models (`Medicine`, `Inventory`, `Order`, `Payment`, `AuditLog`, `Notification`, `Review`, `Complaint`)
* **Milestone:** M1 | **Phase:** 2 | **Feature:** Database | **Sub-Feature:** Operational Models
* **Dependencies:** Task 1.3
* **Files Changed:**
  * `server/src/models/medicine.model.ts` (New)
  * `server/src/models/inventory.model.ts` (New)
  * `server/src/models/order.model.ts` (New)
  * `server/src/models/payment.model.ts` (New)
  * `server/src/models/audit-log.model.ts` (New)
  * `server/src/models/notification.model.ts` (New)
  * `server/src/models/review.model.ts` (New)
  * `server/src/models/complaint.model.ts` (New)
* **Impact:** Database schemas.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement operational schemas. Ensure `Order` embeds item snapshots (`medicineName`, `unitPrice`). Ensure `Review` has unique compound index on `{ appointmentId: 1 }` so each completed visit can only be reviewed once.
* **Manual Actions:** None.
* **Tests Required:** Verify inventory quantity constraints (no negative stock); verify review uniqueness.
* **Security Checks:** AuditLog schema must be append-only (no update/delete methods).
* **Code Review Checklist:** Historical pricing snapshot logic respected in `Order` model definition.
* **Git Branch / Checkpoint:** `feat/m1-commerce-models` $\rightarrow$ `feat(models): implement commerce, payment, audit, and feedback mongoose schemas`
* **Expected Result:** Complete database model foundation is established.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Snapshotting prices and product names in orders protects financial records from future catalog alterations.

---

### Milestone 2: Backend Core Pipeline & Middlewares

#### Task 2.1: Centralized Error Handling & Response Envelope Pipeline
* **Milestone:** M2 | **Phase:** 3 | **Feature:** Foundation | **Sub-Feature:** Error Handling
* **Dependencies:** Milestone 1
* **Files Changed:**
  * `server/src/utils/api-response.ts` (New)
  * `server/src/utils/api-error.ts` (New)
  * `server/src/middlewares/error.middleware.ts` (New)
  * `server/src/app.ts` (Update)
* **Impact:** Backend HTTP response layer.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build standard response helpers (`sendSuccess`, `sendPaginated`) and an `AppError` class. The error middleware must map Zod errors to HTTP 422, Mongoose duplicate keys to HTTP 409, and general errors to HTTP 500, outputting the exact JSON shape from `docs/api/ERROR_TAXONOMY.md`.
* **Manual Actions:** None.
* **Tests Required:** Test response helper shapes and error middleware mapping for validation errors, not found, and internal server errors.
* **Security Checks:** Stack traces must be suppressed in `NODE_ENV === 'production'`.
* **Code Review Checklist:** Conforms 100% to `ApiResponseSuccess` and `ApiResponseError` contracts.
* **Git Branch / Checkpoint:** `feat/m2-error-pipeline` $\rightarrow$ `feat(server): implement centralized error handler and standardized response envelopes`
* **Expected Result:** Every API error emits predictable JSON with domain error codes.
* **Rollback Approach:** Revert changes to `server/src/app.ts`.
* **Learning Rationale:** Consistent error envelopes allow the frontend to display graceful, localized error messages without crashing.

---

#### Task 2.2: Rate Limiting & Security Middlewares
* **Milestone:** M2 | **Phase:** 3 | **Feature:** Foundation | **Sub-Feature:** Security
* **Dependencies:** Task 2.1
* **Files Changed:**
  * `server/src/middlewares/rate-limiter.middleware.ts` (New)
  * `server/src/middlewares/security.middleware.ts` (New)
  * `server/src/app.ts` (Update)
* **Impact:** HTTP request protection.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement security middlewares: Helmet for HTTP headers, CORS configuration with credentials support, and tiered rate limiters (Global: 100 req/min, Auth: 5 attempts/15 min, AI: 10 req/min) returning `RateLimit-*` headers.
* **Manual Actions:** Add `helmet` dependency if required (`npm install helmet`).
* **Tests Required:** Supertest test verifying rate limiter responds with HTTP 429 when threshold exceeded.
* **Security Checks:** CORS origin must strictly match `CLIENT_URL` (no wildcard `*` with credentials).
* **Code Review Checklist:** Proper headers returned (`X-Content-Type-Options`, `RateLimit-Remaining`).
* **Git Branch / Checkpoint:** `feat/m2-security-middleware` $\rightarrow$ `feat(security): configure helmet, cors, and tiered rate limiters`
* **Expected Result:** Backend is shielded against brute-force and HTTP-header vulnerabilities.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Rate limiting at the application gateway prevents credential stuffing and denial-of-service attempts.

---

#### Task 2.3: Audit Logging Service & Pipeline
* **Milestone:** M2 | **Phase:** 3 | **Feature:** Foundation | **Sub-Feature:** Audit Logging
* **Dependencies:** Task 2.1
* **Files Changed:**
  * `server/src/services/audit-log.service.ts` (New)
  * `server/src/middlewares/audit.middleware.ts` (New)
* **Impact:** System auditability.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create asynchronous audit log service that saves events to the `auditLogs` collection without blocking the main request/response loop. Supports logging actor ID, role, action, target resource, IP, and metadata.
* **Manual Actions:** None.
* **Tests Required:** Verify that triggering an audited action creates a non-mutable record in `auditLogs`.
* **Security Checks:** Zero passwords, tokens, or raw medical report contents recorded in audit metadata.
* **Code Review Checklist:** Failures in audit logging do not crash business requests (fail-safe logging).
* **Git Branch / Checkpoint:** `feat/m2-audit-service` $\rightarrow$ `feat(audit): implement asynchronous audit logging service`
* **Expected Result:** Sensitive operations automatically generate traceable audit events.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Critical for healthcare compliance (HIPAA/GDPR-aligned design) to trace who accessed medical data.

---

### Milestone 3: Authentication & Identity Management

#### Task 3.1: Cryptography & JWT Token Service
* **Milestone:** M3 | **Phase:** 4 | **Feature:** Auth | **Sub-Feature:** JWT Service
* **Dependencies:** Milestone 2
* **Files Changed:**
  * `server/src/services/token.service.ts` (New)
  * `server/src/utils/password.ts` (New)
* **Impact:** Authentication engine.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create password hashing/comparison helpers with `bcrypt` (12 rounds) and JWT service generating 15-minute access tokens and 7-day refresh tokens. Implement token verification and refresh token family storage in database for reuse detection.
* **Manual Actions:** None.
* **Tests Required:** Unit tests: password hash verification; token issuance; token expiration check; token signature tamper check.
* **Security Checks:** Secret keys loaded strictly from validated environment config.
* **Code Review Checklist:** Refresh token stored as hash or verified cryptographically; appropriate claims included (`sub`, `role`).
* **Git Branch / Checkpoint:** `feat/m3-jwt-service` $\rightarrow$ `feat(auth): implement bcrypt password hashing and jwt token service`
* **Expected Result:** High-performance, secure token creation and validation utility.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Understanding the difference between symmetric and asymmetric signing, and how refresh token rotation prevents replay attacks.

---

#### Task 3.2: User Registration & Login Endpoints
* **Milestone:** M3 | **Phase:** 4 | **Feature:** Auth | **Sub-Feature:** Auth Endpoints
* **Dependencies:** Task 3.1
* **Files Changed:**
  * `server/src/validators/auth.validator.ts` (New)
  * `server/src/services/auth.service.ts` (New)
  * `server/src/controllers/auth.controller.ts` (New)
  * `server/src/routes/auth.routes.ts` (New)
  * `server/src/routes/index.ts` (New)
  * `server/src/app.ts` (Update)
* **Impact:** API endpoints (`/api/v1/auth/register`, `/login`, `/logout`, `/refresh-token`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement registration and login following `docs/api/API_CONTRACT.md`. Validate with Zod. Create user and linked skeleton profile atomically. Set refresh token in HttpOnly cookie. Handle token rotation on `/refresh-token`.
* **Manual Actions:** None.
* **Tests Required:** Integration tests with Supertest: successful registration for each role, duplicate email rejection (409), login with invalid password (401), token refresh cycle.
* **Security Checks:** Cookies have `httpOnly: true`, `secure: true` (in prod), `sameSite: 'strict'`.
* **Code Review Checklist:** Passwords stripped from responses; status codes match API contract.
* **Git Branch / Checkpoint:** `feat/m3-auth-routes` $\rightarrow$ `feat(auth): implement registration, login, logout, and token rotation endpoints`
* **Expected Result:** Users can register and login across roles; refresh cookies issue properly.
* **Rollback Approach:** Revert routes in `server/src/app.ts`.
* **Learning Rationale:** How HttpOnly cookies protect against XSS token theft compared to storing refresh tokens in localStorage.

---

#### Task 3.3: User Self-Management (`/api/v1/users/me`)
* **Milestone:** M3 | **Phase:** 4 | **Feature:** Users | **Sub-Feature:** Self Profile
* **Dependencies:** Task 3.2
* **Files Changed:**
  * `server/src/middlewares/auth.middleware.ts` (New)
  * `server/src/controllers/user.controller.ts` (New)
  * `server/src/routes/user.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/users/me`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build `authenticate` middleware that extracts and validates the Bearer token and attaches `req.user`. Implement `GET /api/v1/users/me` (returns user and linked profile) and `PATCH /api/v1/users/me` (updates phone, avatar).
* **Manual Actions:** None.
* **Tests Required:** Test accessing `/api/v1/users/me` without token (401), with expired token (401), and with valid token (200).
* **Security Checks:** Users can only view/update their own profile data.
* **Code Review Checklist:** `req.user` strongly typed with TypeScript declaration merging on `Express.Request`.
* **Git Branch / Checkpoint:** `feat/m3-user-me` $\rightarrow$ `feat(users): add authentication middleware and user profile endpoints`
* **Expected Result:** Authenticated endpoints resolve identity correctly.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Mastering Express middleware chaining and typed request augmentation.

---

### Milestone 4: RBAC Authorization & Profiles

#### Task 4.1: Role-Based Access Control (RBAC) & Ownership Middleware
* **Milestone:** M4 | **Phase:** 5 | **Feature:** Security | **Sub-Feature:** RBAC Middleware
* **Dependencies:** Milestone 3
* **Files Changed:**
  * `server/src/middlewares/role.middleware.ts` (New)
  * `server/src/middlewares/ownership.middleware.ts` (New)
* **Impact:** Backend authorization layer.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create `authorizeRole(...allowedRoles)` middleware and `authorizeOwnership(resourceFinder, ownerField)` middleware based on `docs/api/AUTHORIZATION_MATRIX.md`. Rejects unauthorized roles with `AUTH_INSUFFICIENT_PERMISSIONS` (403).
* **Manual Actions:** None.
* **Tests Required:** Test role restriction: Patient trying to access doctor-only route gets 403; Doctor accessing doctor-only route gets 200.
* **Security Checks:** Backend enforces all checks; never trusts client-supplied user IDs.
* **Code Review Checklist:** Strict role comparison against `UserRole` enum.
* **Git Branch / Checkpoint:** `feat/m4-rbac-middleware` $\rightarrow$ `feat(auth): implement rbac role and resource ownership middlewares`
* **Expected Result:** Unauthorized access is blocked deterministically before controllers execute.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Deep understanding of the difference between Authentication ("Who are you?") and Authorization ("What are you allowed to do?").

---

#### Task 4.2: Patient Health Profile Management
* **Milestone:** M4 | **Phase:** 5 | **Feature:** Patients | **Sub-Feature:** Health Profile
* **Dependencies:** Task 4.1
* **Files Changed:**
  * `server/src/validators/patient.validator.ts` (New)
  * `server/src/services/patient.service.ts` (New)
  * `server/src/controllers/patient.controller.ts` (New)
  * `server/src/routes/patient.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/patients/me/profile`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement `GET` and `PUT` `/api/v1/patients/me/profile`. Allow patients to manage blood group, allergies, chronic conditions, and emergency contacts. Validate with Zod.
* **Manual Actions:** None.
* **Tests Required:** Validate allergy array formatting; update profile and verify persistence in MongoDB.
* **Security Checks:** Patients can only mutate their own profile; Doctors can read only with an authorized relationship.
* **Code Review Checklist:** Input sanitized; partial updates handled safely.
* **Git Branch / Checkpoint:** `feat/m4-patient-profile` $\rightarrow$ `feat(patients): implement patient medical profile management`
* **Expected Result:** Patients can read and update their personal health profile.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing clinical data structures that support rapid lookups during triage or consultation.

---

#### Task 4.3: Doctor Profile & Verification Document Submission
* **Milestone:** M4 | **Phase:** 5 | **Feature:** Doctors | **Sub-Feature:** Verification Submission
* **Dependencies:** Task 4.1
* **Files Changed:**
  * `server/src/validators/doctor.validator.ts` (New)
  * `server/src/services/doctor.service.ts` (New)
  * `server/src/controllers/doctor.controller.ts` (New)
  * `server/src/routes/doctor.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/doctors/me/profile`, `/api/v1/doctors/me/verification-documents`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build doctor profile update and document submission endpoints. Submitting credentials shifts verification status from `UNSUBMITTED` to `PENDING_REVIEW` according to the Doctor Verification State Machine in `docs/api/STATE_MACHINES.md`.
* **Manual Actions:** None.
* **Tests Required:** Verify status transition to `PENDING_REVIEW`; duplicate registration number fails with 409.
* **Security Checks:** Verification documents cannot be overwritten once in `APPROVED_VERIFIED` without admin approval.
* **Code Review Checklist:** State transition rules adhered to exactly.
* **Git Branch / Checkpoint:** `feat/m4-doctor-verification` $\rightarrow$ `feat(doctors): implement doctor profile and credential submission workflow`
* **Expected Result:** Doctors can submit licenses and degrees for verification.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Modeling credentialing workflows common to compliant telehealth platforms.

---

#### Task 4.4: Pharmacy Profile & License Submission
* **Milestone:** M4 | **Phase:** 5 | **Feature:** Pharmacies | **Sub-Feature:** License Submission
* **Dependencies:** Task 4.1
* **Files Changed:**
  * `server/src/validators/pharmacy.validator.ts` (New)
  * `server/src/services/pharmacy.service.ts` (New)
  * `server/src/controllers/pharmacy.controller.ts` (New)
  * `server/src/routes/pharmacy.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/pharmacies/me/profile`, `/api/v1/pharmacies/me/license`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement pharmacy profile updates and retail drug license submission. Transitions pharmacy state to `PENDING_REVIEW`.
* **Manual Actions:** None.
* **Tests Required:** Schema validation on retail drug license format and address proof.
* **Security Checks:** Pharmacies cannot list inventory until verified.
* **Code Review Checklist:** Verification status cannot be mutated by pharmacy actor directly.
* **Git Branch / Checkpoint:** `feat/m4-pharmacy-profile` $\rightarrow$ `feat(pharmacies): implement pharmacy profile and drug license submission`
* **Expected Result:** Pharmacies submit verifiable premises credentials.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Understanding B2B onboarding and operational compliance in regulated healthcare commerce.

---

#### Task 4.5: Admin Verification Workflow for Doctors & Pharmacies
* **Milestone:** M4 | **Phase:** 5 | **Feature:** Admin | **Sub-Feature:** Credential Verification
* **Dependencies:** Tasks 4.3, 4.4
* **Files Changed:**
  * `server/src/services/admin.service.ts` (New)
  * `server/src/controllers/admin.controller.ts` (New)
  * `server/src/routes/admin.routes.ts` (New)
* **Impact:** API endpoints (`PATCH /api/v1/admin/doctors/:id/verify`, `PATCH /api/v1/admin/pharmacies/:id/verify`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create admin review endpoints. Admin can approve (`APPROVED_VERIFIED`), request info (`INFO_REQUESTED`), or reject (`REJECTED`) credentials. Writes mandatory audit log entry (`ACTION: DOCTOR_VERIFICATION_APPROVED`).
* **Manual Actions:** Create initial admin user via seed script.
* **Tests Required:** Non-admin accessing endpoint receives 403; approval updates doctor verification state and creates audit log.
* **Security Checks:** Strictly restricted to role `ADMIN`.
* **Code Review Checklist:** Audit record contains admin actor ID, target doctor ID, and timestamp.
* **Git Branch / Checkpoint:** `feat/m4-admin-verification` $\rightarrow$ `feat(admin): implement doctor and pharmacy verification review with audit logging`
* **Expected Result:** Administrators can review and certify medical professionals.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Implementing non-repudiable administrative actions with comprehensive audit trails.

---

### Milestone 5: Doctor Discovery & Availability Scheduling

#### Task 5.1: Doctor Public Directory Search & Filtering
* **Milestone:** M5 | **Phase:** 6 | **Feature:** Doctors | **Sub-Feature:** Public Search
* **Dependencies:** Task 4.5
* **Files Changed:**
  * `server/src/controllers/doctor.controller.ts` (Update)
  * `server/src/services/doctor.service.ts` (Update)
* **Impact:** API endpoints (`GET /api/v1/doctors`, `GET /api/v1/doctors/:id`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement public doctor search with pagination and filters: specialization, location, experience, rating, fee range. Must filter ONLY doctors with `verificationStatus === 'APPROVED_VERIFIED'` and `status === 'ACTIVE'`.
* **Manual Actions:** Seed sample verified doctors for testing.
* **Tests Required:** Test unverified doctors are excluded from search; test filtering by specialty and fee; test pagination.
* **Security Checks:** Private verification documents and personal contact info stripped from public response.
* **Code Review Checklist:** Search queries use indexed fields to prevent full table scans.
* **Git Branch / Checkpoint:** `feat/m5-doctor-search` $\rightarrow$ `feat(doctors): implement public doctor search and filtering engine`
* **Expected Result:** Fast, indexed directory of qualified medical specialists.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Query performance optimization using compound and sparse indexes in MongoDB.

---

#### Task 5.2: Doctor Working Hours & Availability Builder
* **Milestone:** M5 | **Phase:** 6 | **Feature:** Availability | **Sub-Feature:** Schedule Config
* **Dependencies:** Task 5.1
* **Files Changed:**
  * `server/src/models/doctor-availability.model.ts` (New)
  * `server/src/validators/availability.validator.ts` (New)
  * `server/src/services/availability.service.ts` (New)
  * `server/src/controllers/availability.controller.ts` (New)
  * `server/src/routes/availability.routes.ts` (New)
* **Impact:** API endpoints (`PUT /api/v1/doctors/me/availability`, exceptions management).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build doctor schedule management. Doctors configure weekly recurring shifts (e.g. Mon 09:00-13:00, 14:00-18:00), slot duration (15/30/60 min), and date-specific exceptions/leaves.
* **Manual Actions:** None.
* **Tests Required:** Test shift overlap validation (shifts cannot intersect); test leave exception creation.
* **Security Checks:** Only verified doctors can configure schedules.
* **Code Review Checklist:** Time format strictly validated (`HH:mm`).
* **Git Branch / Checkpoint:** `feat/m5-availability-builder` $\rightarrow$ `feat(availability): implement recurring schedule and leave exception management`
* **Expected Result:** Doctors can customize their availability calendar.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing flexible recurring calendar models with exception overrides.

---

#### Task 5.3: Public Slot Computation Engine (`GET /api/v1/doctors/:id/availability`)
* **Milestone:** M5 | **Phase:** 6 | **Feature:** Availability | **Sub-Feature:** Slot Computation
* **Dependencies:** Task 5.2
* **Files Changed:**
  * `server/src/services/availability.service.ts` (Update)
  * `server/src/controllers/availability.controller.ts` (Update)
* **Impact:** API endpoint (`GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement the slot computation algorithm. For a requested date: 1) get doctor's recurring shifts for that day of week; 2) divide into slot chunks (e.g. 30 mins); 3) subtract blocked leaves/exceptions; 4) subtract already booked or locked appointments; 5) mark remaining slots as `available: true`.
* **Manual Actions:** None.
* **Tests Required:** Test slot generation: 09:00-11:00 with 30-min duration yields 4 slots; when 09:30 is booked, it returns `available: false`.
* **Security Checks:** Public endpoint; rate-limited.
* **Code Review Checklist:** Timezone handling explicitly anchored to UTC/doctor clinic timezone.
* **Git Branch / Checkpoint:** `feat/m5-slot-computation` $\rightarrow$ `feat(availability): implement dynamic available slot computation algorithm`
* **Expected Result:** Patients view real-time, accurate available appointment slots.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Algorithmic calculation of dynamic calendar availability without pre-generating infinite database records.

---

### Milestone 6: Appointment System & Concurrency Protection

#### Task 6.1: Two-Phase Slot Reservation & Concurrency Lock
* **Milestone:** M6 | **Phase:** 7 | **Feature:** Appointments | **Sub-Feature:** Booking & Lock
* **Dependencies:** Milestone 5
* **Files Changed:**
  * `server/src/validators/appointment.validator.ts` (New)
  * `server/src/services/appointment.service.ts` (New)
  * `server/src/controllers/appointment.controller.ts` (New)
  * `server/src/routes/appointment.routes.ts` (New)
* **Impact:** API endpoint (`POST /api/v1/appointments`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement appointment booking with double-booking prevention. Patient selects slot -> atomic insert into `appointments` with status `PENDING_PAYMENT` and lock expiration at `Date.now() + 15 mins`. If MongoDB throws duplicate key on `{ doctorId: 1, scheduledStart: 1 }`, catch and return `APPOINTMENT_SLOT_UNAVAILABLE` (HTTP 409).
* **Manual Actions:** None.
* **Tests Required:** Concurrency test: fire 5 simultaneous requests for the exact same slot; verify exactly 1 succeeds and 4 receive HTTP 409.
* **Security Checks:** Idempotency key header supported; validated doctor availability.
* **Code Review Checklist:** Atomic operation used; no separate read-then-write race condition window.
* **Git Branch / Checkpoint:** `feat/m6-appointment-booking` $\rightarrow$ `feat(appointments): implement two-phase slot reservation with atomic concurrency lock`
* **Expected Result:** Double-booking is mathematically impossible under high concurrent load.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How to design distributed race-condition prevention in database management systems.

---

#### Task 6.2: Appointment Management (List, Reschedule, Cancel)
* **Milestone:** M6 | **Phase:** 7 | **Feature:** Appointments | **Sub-Feature:** Lifecycle Management
* **Dependencies:** Task 6.1
* **Files Changed:**
  * `server/src/services/appointment.service.ts` (Update)
  * `server/src/controllers/appointment.controller.ts` (Update)
* **Impact:** API endpoints (`GET /api/v1/appointments`, `PATCH /:id/cancel`, `PATCH /:id/reschedule`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement appointment retrieval with role filtering (Patient sees own, Doctor sees assigned). Implement cancellation with the 2-hour policy rule (cannot cancel within 2 hours of start). Implement rescheduling with atomic slot shifting.
* **Manual Actions:** None.
* **Tests Required:** Test patient cannot cancel appointment starting in 1 hour (HTTP 422); test cancellation >2 hours succeeds and frees the slot.
* **Security Checks:** Ownership verification via `authorizeOwnership`.
* **Code Review Checklist:** Transitions obey the Appointment State Machine.
* **Git Branch / Checkpoint:** `feat/m6-appointment-management` $\rightarrow$ `feat(appointments): implement appointment listing, rescheduling, and 2-hour cancellation rules`
* **Expected Result:** Safe, policy-compliant lifecycle management of appointments.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Business policy enforcement (cancellation penalties/windows) at the domain service layer.

---

#### Task 6.3: Scheduled Worker for Abandoned Slot Release
* **Milestone:** M6 | **Phase:** 7 | **Feature:** Appointments | **Sub-Feature:** Cleanup Worker
* **Dependencies:** Task 6.1
* **Files Changed:**
  * `server/src/jobs/slot-cleanup.job.ts` (New)
  * `server/src/jobs/index.ts` (New)
* **Impact:** Background process.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create a recurring scheduled worker (running every 60 seconds) that finds appointments in `PENDING_PAYMENT` where `lockExpiresAt < new Date()` and transitions them to `CANCELLED`, freeing the calendar slot for other patients.
* **Manual Actions:** None.
* **Tests Required:** Unit test: insert appointment with expired lock; run cleanup worker; verify status becomes `CANCELLED`.
* **Security Checks:** Safe bulk updates with query boundary checks.
* **Code Review Checklist:** Worker does not crash the server on database error.
* **Git Branch / Checkpoint:** `feat/m6-slot-cleanup-job` $\rightarrow$ `feat(jobs): implement automated worker to release expired appointment reservation locks`
* **Expected Result:** Unpaid slots are automatically released back to public availability after 15 minutes.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Asynchronous background maintenance patterns for temporary resource holds.

---

### Milestone 7: Razorpay Payment Integration

#### Task 7.1: Razorpay Order Intent Service
* **Milestone:** M7 | **Phase:** 8 | **Feature:** Payments | **Sub-Feature:** Order Creation
* **Dependencies:** Milestone 6
* **Files Changed:**
  * `server/src/integrations/payment/razorpay.client.ts` (New)
  * `server/src/services/payment.service.ts` (New)
  * `server/src/controllers/payment.controller.ts` (New)
  * `server/src/routes/payment.routes.ts` (New)
* **Impact:** API endpoint (`POST /api/v1/payments/create-intent`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Initialize Razorpay SDK client. Implement intent creation endpoint. When called for an appointment in `PENDING_PAYMENT`, calls Razorpay Orders API with exact fee in smallest currency unit (e.g. paise/cents), creates `Payment` document, and returns `orderId` and `amount` to client.
* **Manual Actions:** Add Razorpay test key/secret to `server/.env`. Install `razorpay` npm package.
* **Tests Required:** Mock Razorpay API; verify payment document created with status `CREATED`.
* **Security Checks:** Amount calculated strictly from database doctor consultation fee, never trusted from client request body.
* **Code Review Checklist:** Currency and amount conversion handled without floating point inaccuracies.
* **Git Branch / Checkpoint:** `feat/m7-razorpay-intent` $\rightarrow$ `feat(payments): implement razorpay client and order intent initialization`
* **Expected Result:** Client receives valid Razorpay order credentials for modal checkout.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Financial integrity: never allow client-side tampering of payment amounts.

---

#### Task 7.2: Cryptographic Webhook Listener & Atomic Settlement
* **Milestone:** M7 | **Phase:** 8 | **Feature:** Payments | **Sub-Feature:** Webhook Verification
* **Dependencies:** Task 7.1
* **Files Changed:**
  * `server/src/controllers/payment.controller.ts` (Update)
  * `server/src/services/payment.service.ts` (Update)
* **Impact:** API endpoint (`POST /api/v1/payments/webhook`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build Razorpay webhook handler. Verifies raw body signature using HMAC SHA-256 against `RAZORPAY_WEBHOOK_SECRET`. On `payment.captured`, runs atomic transaction: 1) update `Payment` to `SUCCESS`; 2) update target `Appointment` to `CONFIRMED`; 3) emit real-time event. Rejects invalid signatures with 401.
* **Manual Actions:** Configure test webhook secret in `server/.env`.
* **Tests Required:** Test signature verification helper: valid signature succeeds, altered payload fails; test idempotent handling of duplicate webhook delivery.
* **Security Checks:** Uses raw request buffer for signature check; rejects before any business processing if signature invalid.
* **Code Review Checklist:** Idempotent: receiving same event twice does not double-credit or cause error.
* **Git Branch / Checkpoint:** `feat/m7-payment-webhook` $\rightarrow$ `feat(payments): implement hmac-sha256 razorpay webhook verification and atomic confirmation`
* **Expected Result:** Server authoritatively confirms appointments only upon verified financial capture.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How webhooks and HMAC signatures establish zero-trust asynchronous communication between third-party gateways and backends.

---

#### Task 7.3: Automated Refund Service
* **Milestone:** M7 | **Phase:** 8 | **Feature:** Payments | **Sub-Feature:** Refunds
* **Dependencies:** Task 7.2
* **Files Changed:**
  * `server/src/services/payment.service.ts` (Update)
* **Impact:** Refund processing on cancellation/rejection.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement `processRefund(paymentId, amount, reason)` service method. Calls Razorpay Refunds API, updates `Payment` to `REFUNDED`, creates audit log, and notifies patient. Integrates with appointment cancellation and doctor rejection flows.
* **Manual Actions:** None.
* **Tests Required:** Mock Razorpay refund call; verify payment record transitions to `REFUNDED`.
* **Security Checks:** Only triggered by system cancellation rules or admin authorization.
* **Code Review Checklist:** Refund failures recorded with error details for manual admin retry.
* **Git Branch / Checkpoint:** `feat/m7-refund-service` $\rightarrow$ `feat(payments): implement automated razorpay refund engine for cancellations`
* **Expected Result:** Approved cancellations initiate instant financial refunds.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing reversible financial transactions and accounting state transitions.

---

### Milestone 8: Virtual Consultation & LiveKit Integration

#### Task 8.1: Consultation Lifecycle Management
* **Milestone:** M8 | **Phase:** 9 | **Feature:** Consultations | **Sub-Feature:** Lifecycle
* **Dependencies:** Milestone 7
* **Files Changed:**
  * `server/src/validators/consultation.validator.ts` (New)
  * `server/src/services/consultation.service.ts` (New)
  * `server/src/controllers/consultation.controller.ts` (New)
  * `server/src/routes/consultation.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/consultations`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement consultation entity lifecycle per `docs/api/STATE_MACHINES.md`. Doctor initializes room session during the appointment window; clinical notes and diagnosis can be submitted upon conclusion, which unlocks prescription generation.
* **Manual Actions:** None.
* **Tests Required:** Test doctor cannot open room >1 hour before scheduled start; test non-attending doctor cannot view or edit consultation.
* **Security Checks:** Explicit participant checks (only assigned Doctor and Patient).
* **Code Review Checklist:** Separate from Appointment entity; preserves clean clinical separation.
* **Git Branch / Checkpoint:** `feat/m8-consultation-lifecycle` $\rightarrow$ `feat(consultations): implement consultation session lifecycle and clinical documentation`
* **Expected Result:** Robust tracking of clinical encounters decoupled from scheduling.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Separation of concerns between administrative scheduling (Appointment) and clinical records (Consultation).

---

#### Task 8.2: LiveKit Cloud Video SDK Integration & Token Generation
* **Milestone:** M8 | **Phase:** 9 | **Feature:** Consultations | **Sub-Feature:** LiveKit Video
* **Dependencies:** Task 8.1
* **Files Changed:**
  * `server/src/integrations/video/livekit.client.ts` (New)
  * `server/src/services/consultation.service.ts` (Update)
  * `server/src/controllers/consultation.controller.ts` (Update)
* **Impact:** API endpoints (`POST /:appointmentId/session`, `GET /:id/token`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Integrate `livekit-server-sdk`. When doctor starts room, server generates an isolated room name (`consultation-<id>`). Implements token generation assigning participant identity, room name, grant permissions (`canPublish`, `canSubscribe`), and 60-minute expiration.
* **Manual Actions:** Add LiveKit API Key and Secret in `server/.env`. Install `livekit-server-sdk`.
* **Tests Required:** Unit test LiveKit token generation: verifies claims, identity, and room match.
* **Security Checks:** Tokens expire strictly after 60 minutes; participants cannot join arbitrary rooms.
* **Code Review Checklist:** Video credentials never exposed to client; tokens cryptographically signed.
* **Git Branch / Checkpoint:** `feat/m8-livekit-integration` $\rightarrow$ `feat(video): integrate livekit server sdk and secure participant token generation`
* **Expected Result:** Doctors and patients receive secure WebRTC tokens to connect to LiveKit video rooms.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How modern managed WebRTC infrastructure uses server-minted JWTs for zero-trust client media authorization.

---

### Milestone 9: Medical Records & Digital Prescriptions

#### Task 9.1: Secure Object Storage Client & Pre-Signed Upload URLs
* **Milestone:** M9 | **Phase:** 10 | **Feature:** Medical Records | **Sub-Feature:** Secure Storage
* **Dependencies:** Milestone 4
* **Files Changed:**
  * `server/src/integrations/storage/s3.client.ts` (New)
  * `server/src/services/medical-record.service.ts` (New)
  * `server/src/controllers/medical-record.controller.ts` (New)
  * `server/src/routes/medical-record.routes.ts` (New)
* **Impact:** API endpoint (`POST /api/v1/medical-records/upload-url`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create object storage client (AWS S3 or compatible cloud storage). Implement pre-signed PUT URL generator. Validates file size (max 15MB) and mime-type (`application/pdf`, images, DICOM). Returns upload URL with 10-minute expiration.
* **Manual Actions:** Add storage credentials in `server/.env`. Install `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
* **Tests Required:** Test upload request with file >15MB fails with 422; test unsupported executable file type rejected.
* **Security Checks:** Zero public read access; bucket policies enforce server-signed access only.
* **Code Review Checklist:** Key generation uses random UUID prefix to avoid path enumeration.
* **Git Branch / Checkpoint:** `feat/m9-presigned-upload` $\rightarrow$ `feat(storage): implement object storage client and pre-signed upload url generator`
* **Expected Result:** Secure, direct-to-cloud uploads bypassing the API server memory.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Direct-to-object storage uploads save server bandwidth and prevent memory bloat from large medical files.

---

#### Task 9.2: Medical Record Metadata & 15-Minute Expiring Download Access
* **Milestone:** M9 | **Phase:** 10 | **Feature:** Medical Records | **Sub-Feature:** Access Authorization
* **Dependencies:** Task 9.1
* **Files Changed:**
  * `server/src/services/medical-record.service.ts` (Update)
  * `server/src/controllers/medical-record.controller.ts` (Update)
* **Impact:** API endpoints (`POST /api/v1/medical-records`, `GET /:id/download-url`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Ingest record metadata after upload. Implement download authorization: verify caller is the patient owner OR a doctor with an active clinical relationship. If authorized, generates pre-signed GET URL valid for 15 minutes and logs `ACTION: MEDICAL_RECORD_ACCESSED`.
* **Manual Actions:** None.
* **Tests Required:** Test unassigned doctor requesting patient record download receives 403; assigned doctor receives valid signed URL; audit log record is created.
* **Security Checks:** Strict adherence to `docs/api/AUTHORIZATION_MATRIX.md` Section 4.
* **Code Review Checklist:** TTL strictly set to 900 seconds (15 minutes).
* **Git Branch / Checkpoint:** `feat/m9-record-access` $\rightarrow$ `feat(records): implement medical record metadata persistence and 15-minute expiring access with audit`
* **Expected Result:** Strict zero-trust protected access to sensitive medical records.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Implementing HIPAA-compliant temporary signed access and access auditing for PHI.

---

#### Task 9.3: Digital Prescription Builder & Cryptographic Issuance
* **Milestone:** M9 | **Phase:** 10 | **Feature:** Prescriptions | **Sub-Feature:** Prescription Builder
* **Dependencies:** Task 8.1
* **Files Changed:**
  * `server/src/validators/prescription.validator.ts` (New)
  * `server/src/services/prescription.service.ts` (New)
  * `server/src/controllers/prescription.controller.ts` (New)
  * `server/src/routes/prescription.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/prescriptions`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement digital prescription builder. Only verified attending doctor can issue. Embeds medication snapshots (name, dosage, frequency, route, duration). Sets 90-day expiration date (`expiresAt = issuedAt + 90 days`). Transitions status to `FINALIZED_ISSUED` (immutable). Emits `PRESCRIPTION_ISSUED` event.
* **Manual Actions:** None.
* **Tests Required:** Verify issued prescription cannot be edited (mutation rejected with 409); verify 90-day expiration calculation.
* **Security Checks:** Unverified doctor cannot issue prescriptions; prescription cannot be issued without valid active consultation.
* **Code Review Checklist:** Prescriptions immutable after issuance.
* **Git Branch / Checkpoint:** `feat/m9-prescription-builder` $\rightarrow$ `feat(prescriptions): implement digital prescription issuance with immutable snapshots and 90-day validity`
* **Expected Result:** Legally compliant, tamper-proof digital prescriptions.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Immutability patterns in medical and legal document generation.

---

### Milestone 10: Pharmacy, Medicines Catalog & Order Fulfillment

#### Task 10.1: Master Medicine Catalog Management
* **Milestone:** M10 | **Phase:** 11 | **Feature:** Medicines | **Sub-Feature:** Catalog
* **Dependencies:** Milestone 4
* **Files Changed:**
  * `server/src/validators/medicine.validator.ts` (New)
  * `server/src/services/medicine.service.ts` (New)
  * `server/src/controllers/medicine.controller.ts` (New)
  * `server/src/routes/medicine.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/medicines`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement master medicine catalog search and admin management. Public search supports name, generic name, category, dosage form, and prescription required filter. Admin endpoints allow creating and modifying drug records.
* **Manual Actions:** Seed initial common medicines (e.g. Paracetamol, Amoxicillin, Metformin).
* **Tests Required:** Test public search returns matching medicines; test non-admin cannot POST to catalog.
* **Security Checks:** Catalog creation restricted strictly to role `ADMIN`.
* **Code Review Checklist:** Search query handles regex/text index escaping safely.
* **Git Branch / Checkpoint:** `feat/m10-medicine-catalog` $\rightarrow$ `feat(medicines): implement master medicine catalog search and admin management`
* **Expected Result:** High-speed searchable directory of pharmaceuticals.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Separating a centralized master product catalog from individual vendor inventories.

---

#### Task 10.2: Pharmacy Inventory & Stock Management
* **Milestone:** M10 | **Phase:** 11 | **Feature:** Inventory | **Sub-Feature:** Pharmacy Stock
* **Dependencies:** Task 10.1
* **Files Changed:**
  * `server/src/validators/inventory.validator.ts` (New)
  * `server/src/services/inventory.service.ts` (New)
  * `server/src/controllers/inventory.controller.ts` (New)
  * `server/src/routes/inventory.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/pharmacies/:id/inventory`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Allow verified pharmacies to add medicines to their stock, set unit prices, batch numbers, and expiration dates. Public endpoint allows patients to query pharmacy stock levels.
* **Manual Actions:** None.
* **Tests Required:** Pharmacy can update stock and price; negative quantities rejected with 422; unverified pharmacy blocked.
* **Security Checks:** Pharmacy A cannot modify Pharmacy B's inventory stock.
* **Code Review Checklist:** Compound unique index on `{ pharmacyId: 1, medicineId: 1 }` prevents duplicate entries.
* **Git Branch / Checkpoint:** `feat/m10-pharmacy-inventory` $\rightarrow$ `feat(inventory): implement pharmacy stock, batch, and pricing management`
* **Expected Result:** Multi-vendor pharmacy inventory tracking.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Multi-tenant inventory management and atomic stock mutations.

---

#### Task 10.3: Medicine Order Placement & Prescription Attachment
* **Milestone:** M10 | **Phase:** 11 | **Feature:** Orders | **Sub-Feature:** Order Creation
* **Dependencies:** Tasks 10.2, 9.3
* **Files Changed:**
  * `server/src/validators/order.validator.ts` (New)
  * `server/src/services/order.service.ts` (New)
  * `server/src/controllers/order.controller.ts` (New)
  * `server/src/routes/order.routes.ts` (New)
* **Impact:** API endpoint (`POST /api/v1/orders`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement order creation. Enforce business rule: if ANY item has `prescriptionRequired: true`, a valid unexpired prescription ID matching the caller is mandatory. Records price snapshots from inventory. Atomically reserves stock. If all items OTC, order transitions to `PHARMACY_ACCEPTED`; if Rx items present, transitions to `PRESCRIPTION_REVIEW`.
* **Manual Actions:** None.
* **Tests Required:** Test order with Rx drug without prescription fails with 422; test order with OTC drugs auto-accepts; test stock is reserved.
* **Security Checks:** Cannot attach another patient's prescription.
* **Code Review Checklist:** Order State Machine transitions respected.
* **Git Branch / Checkpoint:** `feat/m10-order-creation` $\rightarrow$ `feat(orders): implement medicine order placement with prescription enforcement and price snapshots`
* **Expected Result:** Compliant pharmaceutical ordering with automatic prescription routing.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Modeling regulated e-commerce workflows with conditional validation pipelines.

---

#### Task 10.4: Pharmacist Prescription Verification & Fulfillment Pipeline
* **Milestone:** M10 | **Phase:** 11 | **Feature:** Orders | **Sub-Feature:** Fulfillment
* **Dependencies:** Task 10.3
* **Files Changed:**
  * `server/src/services/order.service.ts` (Update)
  * `server/src/controllers/order.controller.ts` (Update)
* **Impact:** API endpoints (`PATCH /:id/prescription-review`, `PATCH /:id/status`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build pharmacist review endpoint (Approve/Reject Rx). If rejected, releases reserved stock and triggers automated refund. Implement fulfillment state progression: `PREPARING` $\rightarrow$ `READY_FOR_DELIVERY` $\rightarrow$ `OUT_FOR_DELIVERY` $\rightarrow$ `DELIVERED`. `DELIVERED` requires matching delivery verification OTP.
* **Manual Actions:** None.
* **Tests Required:** Rejection triggers stock release and refund; non-assigned pharmacy cannot review order; valid OTP completes delivery.
* **Security Checks:** Pharmacist review recorded in audit log (`ACTION: ORDER_PRESCRIPTION_VERIFIED`).
* **Code Review Checklist:** Adheres to Order State Machine in `docs/api/STATE_MACHINES.md`.
* **Git Branch / Checkpoint:** `feat/m10-order-fulfillment` $\rightarrow$ `feat(orders): implement pharmacist prescription verification and otp delivery pipeline`
* **Expected Result:** End-to-end pharmacy fulfillment with safety checks.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Safe state machine transitions with compensation actions (refunds, stock replenishment) on failure.

---

### Milestone 11: Real-Time Sockets, Chat & Notifications

#### Task 11.1: Authenticated Socket.IO Handshake & Room Scoping
* **Milestone:** M11 | **Phase:** 12 | **Feature:** Real-Time | **Sub-Feature:** Socket Server
* **Dependencies:** Milestone 3
* **Files Changed:**
  * `server/src/sockets/socket.server.ts` (New)
  * `server/src/sockets/middlewares/auth.socket.ts` (New)
  * `server/src/server.ts` (Update)
* **Impact:** Real-time transport.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Configure Socket.IO server. Implement handshake authentication middleware validating JWT access token. Rejects unauthenticated connections. Attaches `socket.user`. Implements room joining authorization: only active participants can join `consultation:<id>` or `appointment:<id>`.
* **Manual Actions:** None.
* **Tests Required:** Test socket handshake without token fails; test valid token connects; test unauthorized user cannot join room.
* **Security Checks:** Sockets cannot join arbitrary rooms without database ownership check.
* **Code Review Checklist:** Clean disconnect handlers to prevent memory leaks.
* **Git Branch / Checkpoint:** `feat/m11-socket-server` $\rightarrow$ `feat(sockets): configure authenticated socket.io server and room scoping authorization`
* **Expected Result:** Secure, authenticated WebSocket connection foundation.
* **Rollback Approach:** Revert changes in `server/src/server.ts`.
* **Learning Rationale:** How WebSocket authentication differs from HTTP request/response lifecycles.

---

#### Task 11.2: Consultation Chat & Message Persistence
* **Milestone:** M11 | **Phase:** 12 | **Feature:** Real-Time | **Sub-Feature:** Chat
* **Dependencies:** Task 11.1
* **Files Changed:**
  * `server/src/models/message.model.ts` (New)
  * `server/src/sockets/handlers/chat.handler.ts` (New)
  * `server/src/services/chat.service.ts` (New)
  * `server/src/routes/chat.routes.ts` (New)
* **Impact:** Chat messaging and history API (`/api/v1/conversations/:id/messages`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Handle `send_message` socket event. Validate message length (max 2000 chars), persist to MongoDB `messages` collection, and broadcast to room. Implement paginated REST fallback endpoint to load historical messages.
* **Manual Actions:** None.
* **Tests Required:** Test message persistence; verify message broadcast received by room counterpart; test REST pagination.
* **Security Checks:** Chat active only within allowed window (`scheduledStart - 15m` to `completedAt + 24h`).
* **Code Review Checklist:** Messages sanitize HTML input to prevent XSS payloads.
* **Git Branch / Checkpoint:** `feat/m11-chat-service` $\rightarrow$ `feat(chat): implement consultation message persistence, socket broadcast, and history api`
* **Expected Result:** Reliable, persisted real-time consultation chat.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Hybrid architecture combining WebSockets for instant delivery with MongoDB for permanent auditability.

---

#### Task 11.3: Multi-Channel Notification Dispatcher (In-App & Email)
* **Milestone:** M11 | **Phase:** 12 | **Feature:** Notifications | **Sub-Feature:** Dispatcher
* **Dependencies:** Task 11.1
* **Files Changed:**
  * `server/src/services/notification.service.ts` (New)
  * `server/src/integrations/email/resend.client.ts` (New)
  * `server/src/controllers/notification.controller.ts` (New)
  * `server/src/routes/notification.routes.ts` (New)
* **Impact:** In-app notifications and email alerts.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build notification engine. When system events occur (`APPOINTMENT_CONFIRMED`, `PRESCRIPTION_ISSUED`, `ORDER_DELIVERED`), creates database notification, emits real-time socket event to user's private channel (`user:<id>`), and asynchronously queues email notification.
* **Manual Actions:** Add Resend/SMTP credentials to `server/.env`.
* **Tests Required:** Verify notification created in DB, socket event emitted, and read-status toggling endpoint works.
* **Security Checks:** Private notification channels scoped strictly to user ID.
* **Code Review Checklist:** Email failures do not disrupt transaction completion.
* **Git Branch / Checkpoint:** `feat/m11-notifications` $\rightarrow$ `feat(notifications): implement multi-channel notification dispatcher with socket and email transport`
* **Expected Result:** Users receive instant alerts across app and email.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Event-driven notification dispatching with decoupled delivery channels.

---

### Milestone 12: Feedback, Governance, Analytics & AI Service

#### Task 12.1: Post-Consultation Doctor Review & Rating Engine
* **Milestone:** M12 | **Phase:** 13 | **Feature:** Reviews | **Sub-Feature:** Rating Engine
* **Dependencies:** Milestone 8
* **Files Changed:**
  * `server/src/validators/review.validator.ts` (New)
  * `server/src/services/review.service.ts` (New)
  * `server/src/controllers/review.controller.ts` (New)
  * `server/src/routes/review.routes.ts` (New)
* **Impact:** API endpoints (`POST /api/v1/reviews`, `GET /api/v1/reviews/doctors/:id`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement verified review system. Enforce business rule: patient can ONLY review a doctor for an appointment with `status === 'COMPLETED'`. Limit 1 review per appointment. Recalculates doctor aggregate rating and review count.
* **Manual Actions:** None.
* **Tests Required:** Test patient cannot review doctor without completed appointment (HTTP 422); second review on same appointment fails (HTTP 409); doctor aggregate rating updates correctly.
* **Security Checks:** Anti-fraud validation prevents fake doctor reviews.
* **Code Review Checklist:** Rating strictly clamped between 1 and 5 integer.
* **Git Branch / Checkpoint:** `feat/m12-review-system` $\rightarrow$ `feat(reviews): implement verified post-visit doctor review system and aggregate rating calculation`
* **Expected Result:** Trustworthy doctor ratings tied strictly to verified encounters.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Building anti-spam and verified-purchase patterns in healthcare feedback systems.

---

#### Task 12.2: Platform Complaints & Dispute Resolution
* **Milestone:** M12 | **Phase:** 13 | **Feature:** Governance | **Sub-Feature:** Complaints
* **Dependencies:** Milestone 4
* **Files Changed:**
  * `server/src/validators/complaint.validator.ts` (New)
  * `server/src/services/complaint.service.ts` (New)
  * `server/src/controllers/complaint.controller.ts` (New)
  * `server/src/routes/complaint.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/complaints`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement complaint filing and admin resolution. Users file issues (medical conduct, pharmacy quality, billing dispute). Admin reviews, investigates, updates status (`RESOLVED`, `REJECTED`), and records resolution notes.
* **Manual Actions:** None.
* **Tests Required:** User creates complaint; non-admin cannot resolve complaint (403); admin resolves with notes.
* **Security Checks:** Resolution restricted to role `ADMIN`.
* **Code Review Checklist:** Audit log updated on complaint resolution.
* **Git Branch / Checkpoint:** `feat/m12-complaint-system` $\rightarrow$ `feat(complaints): implement user dispute filing and admin resolution workflow`
* **Expected Result:** Structured platform dispute management.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing operational dispute escalation workflows.

---

#### Task 12.3: Operational Analytics & Financial Reporting
* **Milestone:** M12 | **Phase:** 13 | **Feature:** Analytics | **Sub-Feature:** Metrics
* **Dependencies:** Milestones 6, 7, 10
* **Files Changed:**
  * `server/src/services/analytics.service.ts` (New)
  * `server/src/controllers/analytics.controller.ts` (New)
  * `server/src/routes/analytics.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/analytics/*`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build analytics aggregation engine using MongoDB aggregation pipelines. Admin overview: total users, gross transaction volume, appointment completion rate. Doctor metrics: completed consultations, earnings summary. Pharmacy metrics: order fulfillment volume and revenue.
* **Manual Actions:** None.
* **Tests Required:** Test aggregation pipeline calculations against seeded transactions.
* **Security Checks:** Doctors see only own earnings; pharmacies see only own sales.
* **Code Review Checklist:** Aggregation pipelines leverage indexed date fields.
* **Git Branch / Checkpoint:** `feat/m12-analytics-engine` $\rightarrow$ `feat(analytics): implement role-scoped operational analytics and financial aggregation pipelines`
* **Expected Result:** High-performance business intelligence endpoints.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Efficient database aggregation pipelines for business intelligence and reporting.

---

#### Task 12.4: Isolated AI Service Layer & Healthcare Guardrails
* **Milestone:** M12 | **Phase:** 13 | **Feature:** AI Service | **Sub-Feature:** Safe Assistant
* **Dependencies:** Milestone 3
* **Files Changed:**
  * `server/src/integrations/ai/gemini.client.ts` (New)
  * `server/src/services/ai.service.ts` (New)
  * `server/src/controllers/ai.controller.ts` (New)
  * `server/src/routes/ai.routes.ts` (New)
* **Impact:** API endpoints (`/api/v1/ai/assistant/*`).
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build isolated AI service. Connect to Gemini API / LLM provider. Enforce strict system prompt guardrail: must include non-diagnostic disclaimer; refuse emergency self-diagnosis; explain medical terms in plain language; suggest appropriate specialist types without prescribing.
* **Manual Actions:** Add LLM API key to `server/.env`.
* **Tests Required:** Test emergency symptom query returns emergency referral disclaimer; test medical term query explains terminology simply; verify rate limiter (10 req/min).
* **Security Checks:** PII/PHI stripped before dispatching to external LLM.
* **Code Review Checklist:** Hardcoded provider boundaries; easily swappable adapter.
* **Git Branch / Checkpoint:** `feat/m12-ai-service` $\rightarrow$ `feat(ai): implement isolated non-diagnostic healthcare navigation assistant with safety guardrails`
* **Expected Result:** Safe, responsible, educational AI assistant without clinical liability risks.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How to integrate generative AI safely in regulated domains with defensive prompt engineering.

---

### Milestone 13: Complete Frontend UI Integration

#### Task 13.1: Frontend Design System, Shell Layouts & Routing
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Design System & Shell
* **Dependencies:** Milestones 1–12
* **Files Changed:**
  * `client/src/components/ui/*` (shadcn components: Dialog, Dropdown, Table, Tabs, Card, Badge)
  * `client/src/layouts/AppLayout.tsx` (New)
  * `client/src/layouts/AuthLayout.tsx` (New)
  * `client/src/routes/AppRoutes.tsx` (New)
  * `client/src/stores/auth.store.ts` (New)
  * `client/src/services/api.ts` (Axios / Fetch client with token refresh interceptor)
* **Impact:** Frontend architecture.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Setup React Router, TanStack Query provider, Zustand auth store, and global layout shells with role-based sidebars (Patient, Doctor, Pharmacy, Admin). Configure API client with automatic token refresh on 401. Add reusable UI components from shadcn.
* **Manual Actions:** Install `@tanstack/react-query`, `lucide-react`, and required shadcn components.
* **Tests Required:** Test route guard redirects unauthenticated user to `/login`; test token refresh interceptor.
* **Security Checks:** JWT tokens never stored in localStorage; refresh handled via HttpOnly cookie.
* **Code Review Checklist:** Global loading/empty/error states implemented.
* **Git Branch / Checkpoint:** `feat/m13-frontend-shell` $\rightarrow$ `feat(ui): configure design system, role layouts, router, and api client with refresh interceptor`
* **Expected Result:** Professional, responsive application shell with automated session management.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Structuring scalable React SPA architecture with resilient authentication token renewal.

---

#### Task 13.2: Authentication & Onboarding UI
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Auth Views
* **Dependencies:** Task 13.1
* **Files Changed:**
  * `client/src/features/auth/pages/LoginPage.tsx` (New)
  * `client/src/features/auth/pages/RegisterPage.tsx` (New)
  * `client/src/features/auth/components/RoleSelector.tsx` (New)
* **Impact:** Frontend auth screens.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build clean, trustworthy login and registration flows. Multi-step role-specific registration (Patient vs Doctor vs Pharmacy). Form validation using React Hook Form and Zod. Displays inline API error messages.
* **Manual Actions:** None.
* **Tests Required:** Test form validation blocks submission with invalid email; test successful login routes to role dashboard.
* **Security Checks:** Password visibility toggle; no plain text secrets stored in client state.
* **Code Review Checklist:** Responsive mobile-friendly layout.
* **Git Branch / Checkpoint:** `feat/m13-auth-ui` $\rightarrow$ `feat(ui): implement multi-role login, registration, and onboarding flows`
* **Expected Result:** Seamless, accessible user authentication interface.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing intuitive role-selection UX in multi-sided platforms.

---

#### Task 13.3: Patient Portal (Discovery, Booking Wizard, Records & Orders)
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Patient Portal
* **Dependencies:** Task 13.2
* **Files Changed:**
  * `client/src/features/patients/pages/PatientDashboard.tsx` (New)
  * `client/src/features/doctors/pages/DoctorSearchPage.tsx` (New)
  * `client/src/features/appointments/components/BookingModal.tsx` (New)
  * `client/src/features/medical-records/pages/RecordsPage.tsx` (New)
  * `client/src/features/orders/pages/PatientOrdersPage.tsx` (New)
* **Impact:** Patient user experience.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build complete Patient experience. Doctor search page with faceted filters and doctor cards. Guided booking modal: select type -> choose date/slot -> Razorpay checkout -> confirmation. Medical records upload and download view. Medicine order tracking timeline.
* **Manual Actions:** Test Razorpay checkout modal popup.
* **Tests Required:** Test booking flow through slot selection; test file upload UI; test loading skeletons.
* **Security Checks:** S3 download links use temporary pre-signed URLs.
* **Code Review Checklist:** Follows healthcare design principles: calm colors, high contrast, clear empty states.
* **Git Branch / Checkpoint:** `feat/m13-patient-portal` $\rightarrow$ `feat(ui): implement patient dashboard, doctor discovery, booking wizard, and record management`
* **Expected Result:** Complete patient self-service healthcare management experience.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Complex multi-step wizard state management in React.

---

#### Task 13.4: Doctor Portal (Schedule Builder, Patients, & Prescription Studio)
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Doctor Portal
* **Dependencies:** Task 13.2
* **Files Changed:**
  * `client/src/features/doctors/pages/DoctorDashboard.tsx` (New)
  * `client/src/features/doctors/pages/AvailabilitySettingsPage.tsx` (New)
  * `client/src/features/doctors/pages/DoctorAppointmentsPage.tsx` (New)
  * `client/src/features/prescriptions/components/PrescriptionBuilderModal.tsx` (New)
* **Impact:** Doctor user experience.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build Doctor workflow. Today's appointments schedule; weekly working hours calendar editor; patient clinical history drawer; digital prescription builder with drug dosage/frequency inputs and instant PDF preview.
* **Manual Actions:** None.
* **Tests Required:** Test schedule editor adds and removes shifts; test prescription builder validates at least 1 medicine item before issuing.
* **Security Checks:** Prescription cannot be issued without doctor confirmation.
* **Code Review Checklist:** Clean, uncluttered UI suitable for busy clinicians.
* **Git Branch / Checkpoint:** `feat/m13-doctor-portal` $\rightarrow$ `feat(ui): implement doctor dashboard, schedule manager, and digital prescription builder`
* **Expected Result:** High-efficiency clinical management workstation for doctors.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Designing clinical workflow tools that reduce doctor cognitive load.

---

#### Task 13.5: Pharmacy Portal (Inventory Manager & Rx Review Queue)
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Pharmacy Portal
* **Dependencies:** Task 13.2
* **Files Changed:**
  * `client/src/features/pharmacies/pages/PharmacyDashboard.tsx` (New)
  * `client/src/features/pharmacies/pages/InventoryPage.tsx` (New)
  * `client/src/features/pharmacies/pages/OrderReviewPage.tsx` (New)
* **Impact:** Pharmacy user experience.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build Pharmacy portal. Inventory data table with search, stock counters, price editor, batch numbers, and low-stock alerts. Order intake queue displaying attached prescription images with zoom viewer for pharmacist approval/rejection.
* **Manual Actions:** None.
* **Tests Required:** Test inventory search and stock inline edit; test pharmacist prescription approve/reject buttons.
* **Security Checks:** Prescription viewer securely renders authorized pre-signed image only.
* **Code Review Checklist:** Real-time badge indicators for new orders.
* **Git Branch / Checkpoint:** `feat/m13-pharmacy-portal` $\rightarrow$ `feat(ui): implement pharmacy dashboard, stock inventory table, and prescription review queue`
* **Expected Result:** Professional pharmacy dispensing and fulfillment workspace.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Building responsive data tables and document inspection tools in React.

---

#### Task 13.6: Admin Portal (Operations, Verifications & Audit Trail)
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Admin Portal
* **Dependencies:** Task 13.2
* **Files Changed:**
  * `client/src/features/admin/pages/AdminDashboard.tsx` (New)
  * `client/src/features/admin/pages/VerificationQueuePage.tsx` (New)
  * `client/src/features/admin/pages/AuditLogsPage.tsx` (New)
  * `client/src/features/admin/pages/ComplaintsPage.tsx` (New)
* **Impact:** Admin operations center.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build Admin operations center. Metrics overview with Recharts charts. Doctor/Pharmacy verification queue with document preview and approve/reject actions. Searchable, filterable audit log viewer. Dispute resolution center.
* **Manual Actions:** None.
* **Tests Required:** Test verification approval updates status; test audit log filter queries backend with correct params.
* **Security Checks:** Entire section wrapped in Admin route guard.
* **Code Review Checklist:** Paginated audit log table with date range picker.
* **Git Branch / Checkpoint:** `feat/m13-admin-portal` $\rightarrow$ `feat(ui): implement admin operations center, verification inspection queue, and audit log viewer`
* **Expected Result:** Centralized governance and operational command center.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Enterprise admin dashboard design and audit trail visualization.

---

#### Task 13.7: LiveKit Consultation Room UI & Video Grid
* **Milestone:** M13 | **Phase:** 14 | **Feature:** UI | **Sub-Feature:** Video Room
* **Dependencies:** Tasks 8.2, 13.1
* **Files Changed:**
  * `client/src/features/consultations/pages/ConsultationRoomPage.tsx` (New)
  * `client/src/features/consultations/components/VideoGrid.tsx` (New)
  * `client/src/features/consultations/components/ConsultationChatPanel.tsx` (New)
  * `client/src/features/consultations/components/MediaControls.tsx` (New)
* **Impact:** Telemedicine video interaction.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Build LiveKit video consultation room using `@livekit/components-react`. Video grid with local and remote tracks, mic/camera mute toggles, screen share, session timer, and collapsible side chat panel. Includes "End Consultation" button triggering clinical wrap-up.
* **Manual Actions:** Install `@livekit/components-react` and `livekit-client`.
* **Tests Required:** Test participant token connects to LiveKit room; test mic/camera toggle state; test disconnect routes to summary view.
* **Security Checks:** Camera/mic permissions handled gracefully; token refreshed if near expiration.
* **Code Review Checklist:** Clean teardown of media tracks on unmount.
* **Git Branch / Checkpoint:** `feat/m13-video-room-ui` $\rightarrow$ `feat(ui): implement livekit video consultation room with media controls and live chat panel`
* **Expected Result:** Modern, resilient WebRTC telemedicine consultation room.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Integrating WebRTC video tracks and media controls inside React lifecycle.

---

### Milestone 14: Testing, Security Hardening & Performance

#### Task 14.1: Automated Integration Test Suite (Supertest & Vitest)
* **Milestone:** M14 | **Phase:** 15 | **Feature:** QA | **Sub-Feature:** Integration Tests
* **Dependencies:** Milestones 1–12
* **Files Changed:**
  * `server/tests/auth.test.ts` (New)
  * `server/tests/appointment.test.ts` (New)
  * `server/tests/order.test.ts` (New)
  * `server/tests/prescription.test.ts` (New)
* **Impact:** Test coverage.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Write complete integration tests covering the critical business flows: registration, authentication, appointment booking with concurrency, payment webhook confirmation, prescription issuance, and pharmacy order fulfillment.
* **Manual Actions:** Run `npm run test:server`.
* **Tests Required:** 100% of integration test suites pass in clean CI environment.
* **Security Checks:** Sensitive mock tokens isolated to test environment.
* **Code Review Checklist:** Tests use clean in-memory MongoDB (`mongodb-memory-server`) or isolated test database.
* **Git Branch / Checkpoint:** `test/m14-integration-suite` $\rightarrow$ `test(api): write comprehensive supertest integration suite for core healthcare workflows`
* **Expected Result:** High confidence in backend contracts and state transitions.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How integration tests validate multi-step domain state machines.

---

#### Task 14.2: End-to-End Test Suite (Playwright)
* **Milestone:** M14 | **Phase:** 15 | **Feature:** QA | **Sub-Feature:** E2E Tests
* **Dependencies:** Milestones 13, 14.1
* **Files Changed:**
  * `tests/e2e/patient-booking.spec.ts` (New)
  * `tests/e2e/doctor-prescription.spec.ts` (New)
  * `playwright.config.ts` (New)
* **Impact:** End-to-end user flow testing.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Configure Playwright. Write E2E test for critical patient journey: Patient registers $\rightarrow$ logs in $\rightarrow$ searches doctor $\rightarrow$ books slot $\rightarrow$ verifies confirmation. Write E2E test for doctor prescription issuance.
* **Manual Actions:** Install `@playwright/test` and browsers (`npx playwright install`).
* **Tests Required:** Run `npx playwright test`.
* **Security Checks:** Test accounts clean up after execution.
* **Code Review Checklist:** Resilient locators used (accessible roles, `data-testid`).
* **Git Branch / Checkpoint:** `test/m14-e2e-suite` $\rightarrow$ `test(e2e): configure playwright and implement end-to-end user booking and prescription journeys`
* **Expected Result:** Automated proof that frontend and backend work in harmony.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Automated browser testing to guard against regressions in critical revenue and medical paths.

---

#### Task 14.3: Security Audit & OWASP Hardening
* **Milestone:** M14 | **Phase:** 15 | **Feature:** Security | **Sub-Feature:** Vulnerability Audit
* **Dependencies:** Task 14.2
* **Files Changed:**
  * `server/src/middlewares/sanitize.middleware.ts` (New)
  * `package.json` (Audit fix)
* **Impact:** Security posture.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Implement NoSQL injection sanitization middleware (stripping `$` and `.` operators from request bodies). Run `npm audit` and resolve vulnerabilities. Verify CSP (Content Security Policy) and CORS rules.
* **Manual Actions:** Run `npm audit`.
* **Tests Required:** Test payload with `{"$gt": ""}` is sanitized; run security scan.
* **Security Checks:** Zero critical or high vulnerabilities; strict OWASP Top 10 compliance.
* **Code Review Checklist:** Strict input sanitization across all request paths.
* **Git Branch / Checkpoint:** `sec/m14-security-hardening` $\rightarrow$ `sec(core): add nosql injection sanitization and perform dependency vulnerability remediation`
* **Expected Result:** Hardened, production-ready healthcare application.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Defending Node.js/MongoDB applications against NoSQL injection and client-side script tampering.

---

#### Task 14.4: Performance Optimization & Query Profiling
* **Milestone:** M14 | **Phase:** 15 | **Feature:** Performance | **Sub-Feature:** Optimization
* **Dependencies:** Task 14.3
* **Files Changed:**
  * `server/src/config/database.ts` (Update index sync)
  * `client/vite.config.ts` (Chunking optimization)
* **Impact:** System throughput and load times.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Verify MongoDB query execution plans (`explain('executionStats')`) to ensure all doctor search and appointment queries use indexes (`IXSCAN` instead of `COLLSCAN`). Configure Vite code-splitting and vendor chunking to keep JS bundles under 200KB.
* **Manual Actions:** Run `npm run build` in client and verify bundle size.
* **Tests Required:** Verify bundle visualization report; check DB query times <50ms under local mock load.
* **Security Checks:** None.
* **Code Review Checklist:** All frequently filtered fields have supporting indexes.
* **Git Branch / Checkpoint:** `perf/m14-optimization` $\rightarrow$ `perf(core): optimize database query execution plans and configure vite bundle code splitting`
* **Expected Result:** Sub-second page loads and high query throughput.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Frontend bundle splitting and database execution plan analysis.

---

### Milestone 15: DevOps, Deployment, Documentation & Demo

#### Task 15.1: GitHub Actions CI/CD Pipeline
* **Milestone:** M15 | **Phase:** 16 | **Feature:** DevOps | **Sub-Feature:** CI/CD
* **Dependencies:** Milestone 14
* **Files Changed:**
  * `.github/workflows/ci.yml` (New)
* **Impact:** Automated CI pipeline.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create GitHub Actions workflow triggered on pull requests and pushes to `main`. Runs: 1) lint check; 2) TypeScript compilation (`tsc`); 3) unit and integration tests; 4) client production build.
* **Manual Actions:** Push branch and verify GitHub Actions runner passes.
* **Tests Required:** CI pipeline executes green on GitHub.
* **Security Checks:** Secrets injected via GitHub repository secrets only.
* **Code Review Checklist:** Fast caching configured for `node_modules`.
* **Git Branch / Checkpoint:** `ci/m15-github-actions` $\rightarrow$ `ci(pipeline): configure github actions automated lint, test, and build workflow`
* **Expected Result:** Every pull request is automatically tested before merging.
* **Rollback Approach:** Revert workflow file.
* **Learning Rationale:** Continuous integration best practices to prevent broken code from reaching production.

---

#### Task 15.2: Production Deployment Configuration (Render / Vercel)
* **Milestone:** M15 | **Phase:** 16 | **Feature:** DevOps | **Sub-Feature:** Production Deploy
* **Dependencies:** Task 15.1
* **Files Changed:**
  * `render.yaml` (New)
  * `vercel.json` (New)
  * `server/src/server.ts` (Graceful shutdown hooks)
* **Impact:** Live environment.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create deployment configuration. Backend configured for Render/Railway/AWS (Docker or Node runtime with health check probe `/api/health`). Frontend configured for Vercel with SPA routing rewrite rules. Add graceful shutdown (`SIGTERM`) closing MongoDB and HTTP server cleanly.
* **Manual Actions:** Link GitHub repo to Render and Vercel; configure production environment variables.
* **Tests Required:** Production health check returns 200; frontend loads securely on custom domain.
* **Security Checks:** Production database requires SSL (`ssl=true`); CORS restricts to production frontend domain.
* **Code Review Checklist:** Zero debug flags enabled in production.
* **Git Branch / Checkpoint:** `deploy/m15-production-config` $\rightarrow$ `deploy(infra): configure production deployment descriptors for render and vercel`
* **Expected Result:** Live, globally accessible healthcare platform.
* **Rollback Approach:** Rollback deployment in host dashboard.
* **Learning Rationale:** Production deployment architecture, SSL enforcement, and zero-downtime rolling deploys.

---

#### Task 15.3: Error Tracking & Monitoring (Sentry Integration)
* **Milestone:** M15 | **Phase:** 16 | **Feature:** DevOps | **Sub-Feature:** Observability
* **Dependencies:** Task 15.2
* **Files Changed:**
  * `server/src/config/sentry.ts` (New)
  * `server/src/middlewares/error.middleware.ts` (Update)
  * `client/src/main.tsx` (Update)
* **Impact:** Live error alerting.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Configure Sentry SDK on backend and frontend. Captures unhandled exceptions and performance transaction traces. Sanitizes sensitive health information before sending telemetry.
* **Manual Actions:** Create Sentry project and obtain DSN.
* **Tests Required:** Trigger test error; verify issue appears in Sentry dashboard with stack trace.
* **Security Checks:** PII and medical payload data scrubbed from Sentry error events.
* **Code Review Checklist:** Sampling rate configured appropriately for production.
* **Git Branch / Checkpoint:** `feat/m15-sentry-monitoring` $\rightarrow$ `feat(observability): configure sentry exception tracking and telemetry with pii sanitization`
* **Expected Result:** Instant alerting when exceptions occur in production.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** Production observability and proactive error monitoring without leaking patient data.

---

#### Task 15.4: Comprehensive Documentation & OpenAPI / Swagger Specification
* **Milestone:** M15 | **Phase:** 16 | **Feature:** Documentation | **Sub-Feature:** Developer Docs
* **Dependencies:** Task 15.3
* **Files Changed:**
  * `docs/api/openapi.yaml` (New)
  * `README.md` (Update with live links, architecture diagrams, and setup instructions)
* **Impact:** Repository documentation.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Generate complete OpenAPI 3.0 YAML specification matching the Phase 5 API Contract. Update root `README.md` with high-level architecture diagram, role credentials, test commands, and live deployment links.
* **Manual Actions:** None.
* **Tests Required:** Validate OpenAPI spec in Swagger Editor with zero errors.
* **Security Checks:** No production credentials in documentation.
* **Code Review Checklist:** Clean, professional documentation suitable for technical recruiters and portfolio evaluators.
* **Git Branch / Checkpoint:** `docs/m15-openapi-and-readme` $\rightarrow$ `docs(api): generate openapi 3.0 specification and update comprehensive project documentation`
* **Expected Result:** Industry-grade technical documentation.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How OpenAPI specifications serve as the single source of truth for frontend-backend contracts and client SDK generation.

---

#### Task 15.5: Final Demonstration Script, Realistic Seed Data & Presentation Walkthrough
* **Milestone:** M15 | **Phase:** 16 | **Feature:** Presentation | **Sub-Feature:** Demo Polish
* **Dependencies:** Task 15.4
* **Files Changed:**
  * `server/src/scripts/seed.ts` (New)
  * `docs/DEMO_SCRIPT.md` (New)
* **Impact:** Demonstration readiness.
* **AI Tool / Model:** Claude 3.7 Sonnet / Antigravity Agent.
* **AI Prompt Purpose:** Create a comprehensive database seeder (`npm run seed`) generating: 1) Admin user; 2) 4 Verified doctors with realistic specialties, schedules, and photos; 3) 2 Verified pharmacies with stocked inventories; 4) 2 Patients with medical history. Create a step-by-step 5-minute live demonstration script showing: Doctor search $\rightarrow$ Appointment booking $\rightarrow$ Video consultation $\rightarrow$ Prescription issuance $\rightarrow$ Medicine order fulfillment.
* **Manual Actions:** Run `npm run seed` and rehearse demonstration walkthrough.
* **Tests Required:** Verify `npm run seed` executes without errors and generates all four operational dashboards ready for immediate login.
* **Security Checks:** Demo accounts use standard known dev passwords (`TestPassword123!`).
* **Code Review Checklist:** Script tells a compelling healthcare story highlighting architecture, security, and UX.
* **Git Branch / Checkpoint:** `docs/m15-demo-script` $\rightarrow$ `chore(demo): create comprehensive seed data script and 5-minute evaluator demonstration walkthrough`
* **Expected Result:** Flawless, repeatable demonstration capability for evaluators, portfolio reviews, and technical interviews.
* **Rollback Approach:** Revert commit.
* **Learning Rationale:** How to present a complex full-stack engineering project effectively to senior technical evaluators.

---

## 5. Roadmap Analysis & Execution Summary

### 5.1 Metric Totals
* **Total Milestones:** 16 (M0 through M15)
* **Total Granular Implementation Tasks:** 42 vertical slices
* **Total Domains Covered:** 40 functional areas

### 5.2 Critical Dependency Path (Sequential)
The following sequence forms the rigid architectural spine and **cannot** be parallelized:
1. Environment & Database Models (M0, M1)
2. Backend Pipeline, Middleware & Error Handling (M2)
3. Authentication & RBAC Authorization (M3, M4)
4. Doctor Scheduling & Slot Computation (M5)
5. Appointment Concurrency & Booking (M6)
6. Razorpay Webhook Verification (M7)
7. LiveKit Video Consultations (M8)
8. Digital Prescriptions & Medical Records (M9)
9. Pharmacy Inventory & Order Fulfillment (M10)

### 5.3 Parallelizable Tracks (After Milestone 4)
Once Authentication and RBAC (M3 & M4) are complete, development can branch into parallel tracks if multiple developers or agents work together:
* **Track A (Clinical & Scheduling):** M5 (Availability) $\rightarrow$ M6 (Appointments) $\rightarrow$ M7 (Payments) $\rightarrow$ M8 (Consultations) $\rightarrow$ M9 (Prescriptions).
* **Track B (Commerce & Pharmacy):** M10.1 (Medicines) $\rightarrow$ M10.2 (Pharmacy Stock).
* **Track C (Operations & Governance):** M12.1 (Reviews) $\rightarrow$ M12.2 (Complaints) $\rightarrow$ M12.4 (AI Service).
* **Track D (Frontend Shell):** M13.1 (Design System & App Shell).

### 5.4 Human Decisions Required
1. **Third-Party API Credentials:** Creation of Razorpay Test Account and LiveKit Cloud project keys.
2. **S3 Storage Provider:** Selection of AWS S3, Cloudflare R2, or MinIO for local development.
3. **Seed Doctor & Pharmacy Details:** Confirming test locations and specialty names for realistic demo data.

### 5.5 Highest-Risk Areas & Mitigation Strategies
1. **Double-Booking Race Condition:**
   * *Risk:* Concurrent booking requests for the same doctor slot.
   * *Mitigation:* Compound unique partial index in MongoDB + 15-minute atomic reservation lock (Task 1.3 & Task 6.1).
2. **Payment Webhook Verification:**
   * *Risk:* Fake client payment confirmations or dropped webhooks.
   * *Mitigation:* Zero trust in client flags; strict HMAC SHA-256 signature check; idempotent processing in atomic database transactions (Task 7.2).
3. **Medical Record Data Leaks:**
   * *Risk:* Direct access to S3 files or unauthorized doctor viewing records.
   * *Mitigation:* Private buckets; 15-minute expiring signed URLs; mandatory audit log entry on every download (Task 9.2).
4. **AI Medical Liability:**
   * *Risk:* AI providing inaccurate clinical diagnosis.
   * *Mitigation:* Isolated service layer; strict defensive system prompt disclaimer; non-diagnostic guidance only (Task 12.4).

---

## 6. Recommended First Implementation Task

Upon approval of this roadmap, the first task to execute is:

> **Milestone 0, Task 0.1: Type-Safe Environment Management & Config Validation**  
> *Objective:* Implement Zod-based environment variable parsing in `server/src/config/env.ts` to ensure the backend validates all critical configuration keys on startup and fails fast if any required setting is missing.
