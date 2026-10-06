# LifeLine API Error Taxonomy & Envelope Standard

> **Document Version:** 1.0  
> **Status:** Phase 5 Approved Baseline  
> **Scope:** Universal API Response Standard, HTTP Status Mapping, and Domain Error Code Catalog

---

## 1. Universal Response Envelope Standard

All REST API endpoints in LifeLine adhere to a standardized JSON response contract. Clients (web, mobile, integrations) must be able to reliably predict response shapes across all services.

### 1.1 Success Response Envelope (`2xx`)

```typescript
interface ApiResponseSuccess<T> {
  success: true;
  data: T;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    timestamp?: string;
  };
}
```

#### Example:
```json
{
  "success": true,
  "data": {
    "appointmentId": "apt_6702e1c9a1",
    "doctorName": "Dr. Sarah Jenkins",
    "scheduledStart": "2026-10-15T09:00:00.000Z",
    "status": "CONFIRMED"
  },
  "message": "Appointment scheduled successfully",
  "meta": {
    "timestamp": "2026-10-07T00:25:00.000Z"
  }
}
```

---

### 1.2 Error Response Envelope (`4xx`, `5xx`)

```typescript
interface ApiResponseError {
  success: false;
  error: {
    code: string;               // Unique domain-specific error code
    message: string;            // Human-readable, safe error description
    details?: Array<{           // Granular validation or field errors
      field?: string;
      issue: string;
    }>;
    timestamp?: string;         // ISO timestamp of the error
    requestId?: string;         // Distributed correlation/request ID for debugging
  };
}
```

#### Example (Validation Error - HTTP 422):
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed for provided fields",
    "details": [
      {
        "field": "scheduledStart",
        "issue": "Must be a future date and time"
      },
      {
        "field": "appointmentType",
        "issue": "Invalid appointment type. Expected 'VIDEO' | 'AUDIO' | 'CHAT' | 'IN_PERSON'"
      }
    ],
    "timestamp": "2026-10-07T00:25:00.000Z",
    "requestId": "req_89ab32c10"
  }
}
```

---

## 2. Standard HTTP Status Code Mappings

| HTTP Code | Name | Semantic Meaning in LifeLine |
|:---|:---|:---|
| `200` | OK | Request succeeded. Data returned in body. |
| `201` | Created | Resource successfully created (User, Appointment, Order, etc.). |
| `204` | No Content | Action succeeded with no body returned (e.g., account deactivation, logout). |
| `400` | Bad Request | Syntactically invalid payload or request body format. |
| `401` | Unauthorized | Missing, expired, or invalid JWT authentication token. |
| `403` | Forbidden | Authenticated, but lacking role permission or resource ownership. |
| `404` | Not Found | Resource does not exist, or user lacks access rights to know it exists. |
| `409` | Conflict | State conflict (e.g., double-booking, email already registered, state machine illegal transition). |
| `422` | Unprocessable Entity | Schema/semantic validation failure (e.g., Zod schema validation failed). |
| `429` | Too Many Requests | Rate limit exceeded for IP, user, or sensitive endpoint. |
| `500` | Internal Server Error | Unexpected unhandled server exception. Never leaks stack traces in production. |
| `503` | Service Unavailable | External dependency temporarily unavailable (e.g., Payment gateway, Video provider). |

---

## 3. Domain Error Code Catalog

### 3.1 Authentication & Authorization (`AUTH_*`)
* `AUTH_INVALID_CREDENTIALS` (401): Email or password is incorrect.
* `AUTH_TOKEN_MISSING` (401): No bearer token supplied in Authorization header.
* `AUTH_TOKEN_EXPIRED` (401): Access token has expired; client must refresh.
* `AUTH_TOKEN_INVALID` (401): Token signature is invalid or malformed.
* `AUTH_REFRESH_TOKEN_EXPIRED` (401): Refresh token expired; user must re-authenticate.
* `AUTH_REFRESH_TOKEN_REVOKED` (401): Token reuse detected or token revoked.
* `AUTH_INSUFFICIENT_PERMISSIONS` (403): User role lacks access to this endpoint.
* `AUTH_RESOURCE_ACCESS_DENIED` (403): Resource does not belong to the authenticated actor.
* `AUTH_ACCOUNT_SUSPENDED` (403): User account has been administratively suspended.
* `AUTH_ACCOUNT_PENDING_VERIFICATION` (403): Doctor or Pharmacy account awaits admin approval.
* `AUTH_EMAIL_ALREADY_EXISTS` (409): Provided email address is already in use.
* `AUTH_PHONE_ALREADY_EXISTS` (409): Provided phone number is already registered.

### 3.2 Doctor & Availability (`DOCTOR_*`, `AVAILABILITY_*`)
* `DOCTOR_NOT_FOUND` (404): Doctor profile does not exist.
* `DOCTOR_NOT_VERIFIED` (403): Doctor is not verified by admin; cannot accept appointments.
* `DOCTOR_REGISTRATION_EXISTS` (409): Medical registration number already exists in system.
* `AVAILABILITY_SLOT_INVALID` (422): Slot start must precede slot end time.
* `AVAILABILITY_OVERLAP` (409): Provided working hours overlap with existing active schedule.
* `AVAILABILITY_LEAVE_CONFLICT` (409): Schedule cannot be updated while approved leave exists.

### 3.3 Appointments & Concurrency (`APPOINTMENT_*`)
* `APPOINTMENT_NOT_FOUND` (404): Appointment ID not found.
* `APPOINTMENT_SLOT_UNAVAILABLE` (409): Slot is already reserved or booked by another patient.
* `APPOINTMENT_CONCURRENCY_LOCKED` (409): Slot is currently in a 15-minute checkout lock.
* `APPOINTMENT_DOUBLE_BOOKING_PREVENTED` (409): Doctor already has an active appointment in this window.
* `APPOINTMENT_PAST_DATE` (422): Appointment cannot be scheduled in the past.
* `APPOINTMENT_INVALID_TRANSITION` (409): Requested status change is illegal in the state machine.
* `APPOINTMENT_CANCELLATION_WINDOW_EXPIRED` (422): Cannot cancel within 2 hours of appointment start.
* `APPOINTMENT_ALREADY_COMPLETED` (409): Cannot modify a completed appointment.

### 3.4 Consultations (`CONSULTATION_*`)
* `CONSULTATION_NOT_FOUND` (404): Consultation ID not found.
* `CONSULTATION_NOT_STARTED` (409): Consultation has not been initiated by the doctor.
* `CONSULTATION_ALREADY_ACTIVE` (409): Doctor already has an active consultation room open.
* `CONSULTATION_SESSION_CLOSED` (409): Consultation has ended; video room is closed.
* `CONSULTATION_UNAUTHORIZED_PARTICIPANT` (403): User is neither the doctor nor the patient.
* `CONSULTATION_VIDEO_PROVIDER_ERROR` (503): Managed video provider failed to create session.

### 3.5 Medical Records & File Storage (`RECORD_*`, `FILE_*`)
* `RECORD_NOT_FOUND` (404): Medical record not found.
* `RECORD_ACCESS_DENIED` (403): Patient has not authorized this doctor to view this record.
* `FILE_TYPE_UNSUPPORTED` (422): File format not supported (allowed: PDF, PNG, JPG, DICOM).
* `FILE_SIZE_EXCEEDED` (422): File exceeds maximum allowed upload size (15 MB).
* `FILE_STORAGE_UNAVAILABLE` (503): Object storage service temporarily unreachable.
* `FILE_SIGNATURE_EXPIRED` (401): Pre-signed download URL has expired.

### 3.6 Prescriptions (`PRESCRIPTION_*`)
* `PRESCRIPTION_NOT_FOUND` (404): Prescription not found.
* `PRESCRIPTION_ALREADY_FINALIZED` (409): Issued prescription is immutable and cannot be edited.
* `PRESCRIPTION_EXPIRED` (422): Prescription has passed its validity window (e.g. >90 days).
* `PRESCRIPTION_MEDICINE_MISSING` (422): Prescription must contain at least one medicine item.
* `PRESCRIPTION_UNAUTHORIZED_DOCTOR` (403): Only the attending doctor may issue the prescription.

### 3.7 Pharmacy & Inventory (`PHARMACY_*`, `INVENTORY_*`, `MEDICINE_*`)
* `PHARMACY_NOT_FOUND` (404): Pharmacy profile not found.
* `PHARMACY_NOT_VERIFIED` (403): Pharmacy is not approved to fulfill orders.
* `MEDICINE_NOT_FOUND` (404): Medicine catalog item not found.
* `INVENTORY_INSUFFICIENT_STOCK` (409): Quantity requested exceeds available pharmacy stock.
* `INVENTORY_ITEM_EXPIRED` (422): Cannot dispense batch past expiration date.
* `MEDICINE_PRESCRIPTION_REQUIRED` (422): Rx item cannot be dispensed without valid verified prescription.

### 3.8 Orders & Fulfillment (`ORDER_*`)
* `ORDER_NOT_FOUND` (404): Order not found.
* `ORDER_INVALID_STATE_TRANSITION` (409): Order cannot transition to the requested state.
* `ORDER_PRESCRIPTION_MISSING` (422): Prescription required for scheduled drugs in order.
* `ORDER_PRESCRIPTION_REJECTED` (422): Pharmacy pharmacist rejected the attached prescription.
* `ORDER_CANNOT_BE_CANCELLED` (422): Order has already dispatched or reached delivery agent.

### 3.9 Payments (`PAYMENT_*`)
* `PAYMENT_NOT_FOUND` (404): Payment transaction not found.
* `PAYMENT_GATEWAY_ERROR` (503): Payment gateway failed to respond.
* `PAYMENT_VERIFICATION_FAILED` (400): Server-side cryptographic signature check failed.
* `PAYMENT_ALREADY_PROCESSED` (409): Transaction has already been captured and processed.
* `PAYMENT_WEBHOOK_SIGNATURE_INVALID` (401): Webhook secret signature verification failed.
* `PAYMENT_REFUND_FAILED` (500): Refund processing rejected by gateway.

### 3.10 Chat & Real-Time Events (`CHAT_*`, `SOCKET_*`)
* `CONVERSATION_NOT_FOUND` (404): Conversation does not exist.
* `CHAT_ACCESS_DENIED` (403): User not an active participant in this consultation chat.
* `CHAT_MESSAGE_TOO_LONG` (422): Message exceeds maximum character limit (2000 chars).
* `SOCKET_AUTHENTICATION_FAILED` (401): Socket handshake missing valid JWT.

### 3.11 AI Service Guardrails (`AI_*`)
* `AI_PROVIDER_UNAVAILABLE` (503): AI provider is unreachable.
* `AI_SAFETY_VIOLATION` (400): Prompt violated healthcare safety guidelines.
* `AI_DIAGNOSTIC_QUERY_REFUSED` (400): System refused autonomous medical diagnosis request.
* `AI_RATE_LIMIT_EXCEEDED` (429): AI assistant token limit reached for this user window.

### 3.12 General & System (`VALIDATION_*`, `SYSTEM_*`)
* `VALIDATION_ERROR` (422): Request payload failed Zod schema checks.
* `RATE_LIMIT_EXCEEDED` (429): Too many requests; retry after specified seconds.
* `IDEMPOTENCY_CONFLICT` (409): Request with identical idempotency key is already processing.
* `DATABASE_TRANSACTION_FAILED` (500): Atomic database transaction failed or timed out.
* `INTERNAL_SERVER_ERROR` (500): Generic unexpected internal server fault.
