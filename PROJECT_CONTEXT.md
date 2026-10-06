# PROJECT_CONTEXT.md
# Digital Healthcare & Telemedicine Platform
# Master Project Context / Continuation Document
# Version: 1.0 — 2026-08-15
# Status: Architecture & Product Planning — Before Phase 5

---

## 0. PURPOSE OF THIS FILE

This file is the single source of truth for continuing the Digital Healthcare & Telemedicine Platform project across ChatGPT chats, Claude, Cursor, Gemini, GitHub Copilot, or any other AI coding/planning tool.

IMPORTANT:
- Do not assume previous chat history is available.
- Treat this document as the authoritative project context.
- Do not skip phases.
- Do not start coding until the relevant architecture/contract phase has been completed.
- Do not silently change major technology, architecture, database strategy, API contracts, or product scope.
- If a change is genuinely necessary, explain why, identify the affected parts, and ask for/record approval before treating it as the new baseline.
- The user wants to learn the implementation, not merely receive generated code.
- AI must work incrementally and avoid generating the whole application in one shot.
- Every implementation step must be small, testable, reviewable, and Git-checkpointed.

---

# 1. PROJECT TITLE

Digital Healthcare & Telemedicine Platform ("LifeLine")

A web/mobile-oriented healthcare platform that allows users to manage major healthcare needs from one application.

The platform is intended to be:
- Modern
- Professional
- Well-managed
- Secure by design
- Scalable
- Demonstrable as a serious full-stack project
- Educational for the user
- Built with AI assistance without becoming dependent on uncontrolled AI-generated code

The project should impress evaluators/users through:
- Strong architecture
- Good UI/UX
- Realistic workflows
- Security/access control
- Proper testing
- Documentation
- Clean Git history
- Professional deployment
- Useful AI-assisted features
- Good error/loading/empty states
- Auditability
- Clear separation of concerns

---

# 2. USER'S MAIN DEVELOPMENT GOAL

The user wants to build this project using an AI-assisted software-development workflow.

The desired workflow is:
1. Define project thoroughly.
2. Expand and improve features.
3. Freeze product scope/baseline.
4. Design technical architecture.
5. Design database.
6. Design UI/UX.
7. Design API/backend contracts.
8. Create a detailed master roadmap.
9. Break roadmap into milestones.
10. Break milestones into very small individual changes/tasks.
11. For every task:
    - Select the best AI/tool.
    - Give an exact prompt.
    - Tell the user what to do manually.
    - Tell the user what files should change.
    - Explain why the change is needed.
    - Implement incrementally.
    - Run tests.
    - Review AI-generated code.
    - Commit to Git at appropriate checkpoints.
12. Integrate features gradually.
13. Perform security/testing/review.
14. Deploy.
15. Polish documentation/demo/presentation.

---

# 3. CORE PRODUCT IDEA

The platform provides one application for healthcare management.

Users can:
- Create accounts
- Maintain health profiles
- Search doctors/specialists (by specialization, location, experience, rating, availability)
- Book, reschedule, and cancel appointments
- Consult doctors online via video, audio, and chat
- Upload medical reports and view medical history
- Receive digital prescriptions
- Search/order medicines and track orders
- Receive notifications and reminders
- Rate and review doctors
- Access safe, non-diagnostic AI assistance

Dashboards:
- Patients
- Doctors
- Pharmacies
- Administrators

---

# 4. ORIGINAL CORE FEATURES

## 4.1 PATIENT
- Registration/login
- Personal health profile
- Search doctors (specialization, location, experience, availability)
- Book, reschedule, cancel appointments
- Online video, audio, and chat consultations
- Upload prescriptions and medical reports
- Digital prescription history & medical records
- Medicine search, orders, and tracking
- Notifications and reminders
- Ratings and reviews

## 4.2 DOCTOR
- Doctor registration & credential verification
- Doctor profile & availability management
- Appointment management & patient history view
- Online consultation
- Digital prescription builder
- Document upload/view
- Earnings dashboard & schedule view

## 4.3 PHARMACY
- Medicine catalogue & stock/inventory management
- Prescription verification
- Order management & delivery tracking

## 4.4 ADMIN
- Manage patients, doctors, pharmacies, and appointments
- Verify doctors & pharmacies
- Monitor orders and payments
- Platform reports, analytics, complaints, and audit logs

---

# 5. CORE PRODUCT/SCOPE PRINCIPLES

1. Coherent unified product across all four roles.
2. UI communicates trust, clarity, accessibility, and speed.
3. Avoid visual bloat, excessive animations, clutter, and unneeded popups.
4. Privacy, authorization, and auditability are first-class citizens.
5. AI assistant is strictly supportive, non-diagnostic, and never replaces a doctor.

---

# 6. DEVELOPMENT BASELINE / PHASE STATUS

- PHASE 1 — Product Definition & Feature Expansion: COMPLETED
- PHASE 2 — Technical Architecture: COMPLETED
- PHASE 3 — Database Architecture: High-level designed
- PHASE 4 — UI/UX Architecture: High-level designed
- PHASE 5 — API & Backend Contract: CURRENT PHASE
- PHASE 6 — Master Development Roadmap
- PHASE 7 — AI Tool/Model Allocation
- PHASE 8 — Repository Initialization: COMPLETED

---

# 7. TECHNICAL ARCHITECTURE BASELINE

- Architecture: Modular Monolith (Client-Server separation)
- Frontend: React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- Client State: Zustand + TanStack Query
- Backend: Node.js + Express + TypeScript
- Database: MongoDB + Mongoose
- Validation: Zod
- Real-Time: Socket.IO
- Video: Managed infrastructure initially (WebRTC optional)
- File Storage: Secure cloud object storage (metadata in MongoDB, authorized access only)
- Payments: Server-side verified (Stripe / Razorpay)
- Email: Resend / SMTP
- Testing: Vitest, Supertest, Playwright
