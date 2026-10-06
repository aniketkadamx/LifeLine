# LifeLine — Digital Healthcare & Telemedicine Platform

> **Status:** Project Initialized — Architecture & Repository Baseline  
> **Source of Truth:** [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md)  
> **Architecture Pattern:** Modular Monolith (Client-Server Separation)

---

## 1. Overview

LifeLine is a modern, full-stack digital healthcare and telemedicine platform engineered to manage major healthcare workflows from a single unified application. It serves four distinct user roles:
- **Patients**: Discovery, appointment scheduling, video/audio/chat consultations, medical records, digital prescriptions, medicine orders.
- **Doctors**: Credential verification, availability schedules, consultations, digital prescription builder, patient history.
- **Pharmacies**: Inventory management, prescription review, order fulfillment.
- **Administrators**: Operational oversight, doctor credentials verification, dispute resolution, analytics, audit logs.

---

## 2. Technology Stack

- **Frontend**:
  - React 19 + Vite + TypeScript
  - Tailwind CSS + shadcn/ui
  - State: Zustand (client state) + TanStack Query (server state)
  - Icons: Lucide React
  - Testing: Vitest
- **Backend**:
  - Node.js + Express + TypeScript
  - Database: MongoDB + Mongoose
  - Validation: Zod
  - Real-Time: Socket.IO
  - Security: JWT (Access + Refresh tokens)
  - Testing: Vitest + Supertest
- **Repository Strategy**:
  - Clean separation: `/client` and `/server`
  - Git-checkpointed incremental delivery

---

## 3. Repository Structure

```text
lifeline/
├── client/                     # Frontend Application (React + Vite + TS)
│   ├── src/
│   │   ├── app/                # Application shell and top-level providers
│   │   ├── assets/             # Static graphics and icons
│   │   ├── components/         # Reusable design system & UI components
│   │   │   ├── ui/             # shadcn/ui components (e.g., button)
│   │   │   └── common/         # Domain-agnostic common components
│   │   ├── features/           # Domain/feature modules
│   │   │   ├── auth/
│   │   │   ├── patients/
│   │   │   ├── doctors/
│   │   │   ├── appointments/
│   │   │   ├── consultations/
│   │   │   ├── medical-records/
│   │   │   ├── prescriptions/
│   │   │   ├── medicines/
│   │   │   ├── orders/
│   │   │   ├── payments/
│   │   │   ├── notifications/
│   │   │   └── reviews/
│   │   ├── hooks/              # Custom React hooks
│   │   ├── layouts/            # Layout wrappers
│   │   ├── lib/                # Utilities (utils.ts)
│   │   ├── pages/              # Route views
│   │   ├── routes/             # Client-side routing
│   │   ├── services/           # API clients
│   │   ├── stores/             # Zustand stores
│   │   └── types/              # Frontend TypeScript definitions
│   ├── components.json         # shadcn configuration
│   └── vite.config.ts          # Vite build configuration
│
├── server/                     # Backend Application (Node.js + Express + TS)
│   ├── src/
│   │   ├── config/             # Environment, DB, and server configuration
│   │   ├── controllers/        # Request handling and HTTP transport
│   │   ├── integrations/       # External services (video, payments, storage)
│   │   ├── jobs/               # Asynchronous tasks / workers
│   │   ├── middlewares/        # Auth, RBAC, error handling, rate limiting
│   │   ├── models/             # Mongoose schemas & data models
│   │   ├── repositories/       # Data-access abstraction
│   │   ├── routes/             # Express API routes
│   │   ├── services/           # Domain business logic
│   │   ├── sockets/            # Socket.IO handlers
│   │   ├── types/              # Backend TypeScript definitions
│   │   ├── utils/              # Helper functions
│   │   ├── validators/         # Zod validation schemas
│   │   ├── app.ts              # Express application setup
│   │   └── server.ts           # Server bootstrap & Socket.IO listener
│   ├── tests/                  # Integration & unit test suites
│   ├── .env.example            # Environment variables template
│   └── tsconfig.json           # Server TypeScript configuration
│
├── .gitignore                  # Monorepo git ignore rules
├── package.json                # Root workflow orchestration scripts
└── README.md                   # Project documentation
```

---

## 4. Getting Started

### Prerequisites
- Node.js >= 20.x (Tested on v24.x)
- npm >= 10.x

### Installation
From the root directory:
```bash
# Install backend dependencies
cd server && npm install && cd ..

# Install frontend dependencies
cd client && npm install && cd ..
```

### Running Locally
Run services in separate terminals:

```bash
# Start backend server (http://localhost:5000)
npm run dev:server

# Start frontend application (http://localhost:5173)
npm run dev:client
```

### Health Check Verification
Verify backend health check:
```bash
curl http://localhost:5000/api/health
```

### Running Tests
```bash
npm run test:server
npm run test:client
```

---

## 5. Next Planned Phase
- **Phase 5 — API & Backend Contract**: Formalize endpoint catalogs, payload validation schemas (Zod), status codes, RBAC permission matrices, concurrency controls, and state transitions before feature implementation.
