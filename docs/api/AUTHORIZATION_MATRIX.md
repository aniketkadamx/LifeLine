# LifeLine RBAC & Resource Ownership Authorization Matrix

> **Document Version:** 1.0  
> **Status:** Phase 5 Approved Baseline  
> **Scope:** Role-Based Access Control (RBAC), Attribute/Ownership Rules (ABAC), Medical File Authorization, Chat Security, and Audit Logging

---

## 1. User Roles & Scope Definitions

LifeLine enforces strict server-side access control. Frontend UI guards are cosmetic only; the Express authorization middleware layer (`authorizeRole` and `authorizeOwnership`) evaluates every request before it hits business logic.

| Role | System Scope |
|:---|:---|
| `PUBLIC` | Unauthenticated visitors. Access restricted to doctor search, public medicine catalog, and auth endpoints. |
| `PATIENT` | Authenticated patients. Full access to own records, appointments, consultations, prescriptions, orders, reviews. |
| `DOCTOR` | Verified medical practitioners. Access to own schedule, assigned appointments, clinical consultation rooms, prescription builder, and authorized patient clinical history. |
| `PHARMACY` | Verified licensed pharmacies. Access to own inventory stock, order routing queue, and prescription verification for assigned orders. |
| `ADMIN` | System operations & compliance officers. Platform oversight, credential verification, complaints, audit logs, and global analytics. |

---

## 2. Global Authorization Rules

1. **Principle of Least Privilege**: Users are granted only the minimum permissions required for their active role.
2. **Explicit Ownership Verification**: When accessing a resource with an ID (e.g., `GET /api/v1/appointments/:id`), the backend verifies that `resource.patientId === req.user.id` or `resource.doctorId === req.user.id`.
3. **Never Trust Client Payloads**: IDs in the request body (such as `userId`, `patientId`, `uploaderId`) cannot override `req.user.id` extracted from the cryptographically verified JWT access token.
4. **Verification Requirement**: Doctors with `verificationStatus !== 'VERIFIED'` cannot set availability, accept appointments, or issue prescriptions. Pharmacies with `verificationStatus !== 'VERIFIED'` cannot fulfill orders.

---

## 3. Resource by Role Permission Matrix

Legend:
* **ALLOW**: Permitted without additional ownership check.
* **OWN**: Permitted **only** if the resource belongs to or is assigned to the authenticated user.
* **REL**: Permitted **only** if a legitimate clinical relationship exists (e.g. Doctor with active appointment for that Patient).
* **DENY**: Forbidden (HTTP 403 Forbidden).

| Resource Domain | Action | PUBLIC | PATIENT | DOCTOR | PHARMACY | ADMIN |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **Auth** | Register / Login / Refresh | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Auth** | Logout / Reset Password | DENY | OWN | OWN | OWN | OWN |
| **Users** | View Own Profile | DENY | OWN | OWN | OWN | OWN |
| **Users** | Manage User Accounts | DENY | DENY | DENY | DENY | ALLOW |
| **Patients** | View / Update Health Profile | DENY | OWN | REL | DENY | ALLOW |
| **Doctors** | Search / Browse Directory | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Doctors** | Update Professional Profile | DENY | DENY | OWN | DENY | ALLOW |
| **Doctors** | Verify Credentials | DENY | DENY | DENY | DENY | ALLOW |
| **Availability**| View Doctor Available Slots | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Availability**| Modify Doctor Working Hours | DENY | DENY | OWN | DENY | ALLOW |
| **Appointments**| Create Booking Intent | DENY | ALLOW | DENY | DENY | DENY |
| **Appointments**| View Appointment Details | DENY | OWN | OWN | DENY | ALLOW |
| **Appointments**| Reschedule Appointment | DENY | OWN | OWN | DENY | ALLOW |
| **Appointments**| Cancel Appointment | DENY | OWN | OWN | DENY | ALLOW |
| **Consultations**| Initiate / Join Virtual Room | DENY | OWN | OWN | DENY | ALLOW (Audit) |
| **Consultations**| Submit Clinical Notes | DENY | DENY | OWN | DENY | ALLOW |
| **Medical Records**| Upload Personal Record | DENY | OWN | REL | DENY | DENY |
| **Medical Records**| View / Download Record File | DENY | OWN | REL | DENY | ALLOW (Audit) |
| **Medical Records**| Delete Medical Record | DENY | OWN | DENY | DENY | ALLOW (Super) |
| **Prescriptions**| Issue Digital Prescription | DENY | DENY | OWN (Verified) | DENY | DENY |
| **Prescriptions**| View Prescription Details | DENY | OWN | OWN | ASSIGNED | ALLOW |
| **Medicines** | Search Catalog | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Medicines** | Manage Master Catalog | DENY | DENY | DENY | DENY | ALLOW |
| **Pharmacies**| Browse Verified Pharmacies | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Inventory** | View Pharmacy Stock | ALLOW | ALLOW | ALLOW | OWN | ALLOW |
| **Inventory** | Update Batch / Stock / Price | DENY | DENY | DENY | OWN | ALLOW |
| **Orders** | Place Medicine Order | DENY | ALLOW | DENY | DENY | DENY |
| **Orders** | View Order Details | DENY | OWN | DENY | ASSIGNED | ALLOW |
| **Orders** | Update Order Processing State| DENY | DENY | DENY | ASSIGNED | ALLOW |
| **Payments** | Initiate Payment Intent | DENY | ALLOW | DENY | DENY | ALLOW |
| **Payments** | View Payment Transaction | DENY | OWN | OWN (Earnings)| ASSIGNED | ALLOW |
| **Payments** | Process Refund | DENY | DENY | DENY | DENY | ALLOW |
| **Notifications**| View / Read Notifications | DENY | OWN | OWN | OWN | OWN |
| **Messages** | Join Real-Time Chat Room | DENY | OWN | OWN | DENY | DENY |
| **Reviews** | Submit Doctor Review | DENY | OWN (Post-Visit)| DENY | DENY | DENY |
| **Reviews** | Moderate Review | DENY | DENY | DENY | DENY | ALLOW |
| **Complaints** | Submit Complaint / Dispute | DENY | OWN | OWN | OWN | ALLOW |
| **Complaints** | Resolve / Dismiss Complaint | DENY | DENY | DENY | DENY | ALLOW |
| **Admin** | Audit Logs Inspection | DENY | DENY | DENY | DENY | ALLOW |
| **Analytics** | System Metrics & Revenue | DENY | DENY | OWN (Earnings)| OWN (Sales)| ALLOW (Global) |
| **AI Service** | Healthcare Navigator / Term Explainer | DENY | ALLOW | ALLOW | DENY | ALLOW |

---

## 4. Medical File Access Authorization (Zero-Trust Model)

Medical documents (blood reports, imaging, biopsy reports, prescription PDFs) contain sensitive Protected Health Information (PHI).

### 4.1 Storage & Access Pipeline
1. **No Public S3 Buckets**: The object storage bucket is entirely private (`public-read` is disabled).
2. **Metadata in MongoDB**: MongoDB stores only the file metadata (`storageKey`, `mimeType`, `sizeBytes`, `patientId`, `uploadedBy`, `checksum`).
3. **Pre-Signed Expiring URLs**: Clients NEVER download files directly from permanent URLs. To download or view:
   * Client calls `GET /api/v1/medical-records/:id/download-url`.
   * Backend checks authorization:
     * Is the actor the `patientId`? -> **ALLOW**
     * Is the actor a `DOCTOR` who has an active appointment or consultation with this patient? -> **ALLOW**
     * Otherwise -> **HTTP 403 Forbidden**.
   * If authorized, backend generates a cryptographically signed S3 pre-signed URL with a **15-minute expiration (TTL = 900 seconds)**.
   * Backend logs an audit event: `ACTION: MEDICAL_RECORD_ACCESSED`.

---

## 5. Real-Time Chat & Consultation Room Authorization

1. **Socket.IO Handshake Authentication**:
   * Client must provide the JWT Access Token in `auth.token` during Socket handshake.
   * If expired or missing, socket connection is immediately terminated (`HTTP 401 Unauthorized`).
2. **Room Scoping**:
   * Rooms are named strictly by domain entity: `appointment:<appointmentId>` or `consultation:<consultationId>`.
   * When a client emits `join_room`, the server queries the database:
     * Is `socket.user.id === appointment.patientId` OR `socket.user.id === appointment.doctorId`?
     * If neither, the server drops the socket from the room and logs a security alert.
3. **Temporal Chat Windows**:
   * Chat is active only between `scheduledStart - 15 minutes` and `appointmentCompletedAt + 24 hours` (to allow post-consultation follow-up questions).
   * Outside this window, room is read-only.

---

## 6. Audit Logging Policy

The audit logging framework provides non-repudiable proof of sensitive clinical, financial, and administrative operations.

### 6.1 Audit Log Schema Baseline
```typescript
interface AuditLogRecord {
  id: string;
  actorId: string;             // User ID who performed the action
  actorRole: "PATIENT" | "DOCTOR" | "PHARMACY" | "ADMIN" | "SYSTEM";
  action: string;              // Structured action enum
  resourceType: string;        // "APPOINTMENT" | "MEDICAL_RECORD" | "PRESCRIPTION" | "ORDER" | "DOCTOR_VERIFICATION"
  resourceId: string;          // Target entity ID
  patientId?: string;          // Subject patient ID (if clinical data involved)
  ipAddress?: string;          // Origin IP (hashed or anonymized where required)
  userAgent?: string;
  metadata?: Record<string, unknown>; // Non-sensitive context (e.g. status change from->to)
  timestamp: string;           // ISO 8601 UTC
}
```

### 6.2 Mandatory Audited Actions
* `DOCTOR_VERIFICATION_APPROVED` / `DOCTOR_VERIFICATION_REJECTED` (Admin)
* `PHARMACY_VERIFICATION_APPROVED` (Admin)
* `USER_ACCOUNT_SUSPENDED` / `USER_ACCOUNT_REINSTATED` (Admin)
* `MEDICAL_RECORD_VIEWED` / `MEDICAL_RECORD_DOWNLOADED` (Doctor or Admin)
* `PRESCRIPTION_ISSUED` (Doctor)
* `PRESCRIPTION_REVOKED` (Doctor or Admin)
* `ORDER_PRESCRIPTION_VERIFIED` / `ORDER_PRESCRIPTION_REJECTED` (Pharmacy)
* `PAYMENT_REFUND_ISSUED` (Admin or Automated System)
* `APPOINTMENT_CANCELLED_BY_DOCTOR` (Doctor)
* `CLINICAL_NOTE_MODIFIED` (Doctor)
