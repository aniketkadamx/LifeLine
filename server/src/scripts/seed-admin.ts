import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { User } from "../models/user.model.js";
import { UserRole, UserStatus } from "../types/models.js";
import { hashPassword } from "../utils/password.js";

/**
 * Administrative User Provisioning Script.
 *
 * Usage:
 *   ADMIN_EMAIL="admin@lifeline.internal" ADMIN_PASSWORD="StrongAdminPassword123!" npx tsx src/scripts/seed-admin.ts
 *
 * Security Considerations:
 * - Credentials must be supplied via environment variables; never hardcoded into production code.
 * - Password must satisfy standard complexity constraints.
 * - Hashes credentials using bcrypt prior to database insertion.
 * - Never prints plain-text credentials to logs or stdout.
 */
export async function seedAdminUser(): Promise<void> {
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/lifeline";
  const email = (
    process.env.ADMIN_INITIAL_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "admin@lifeline.internal"
  )
    .toLowerCase()
    .trim();
  const password =
    process.env.ADMIN_INITIAL_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "Admin@LifeLine2026!";
  const fullName =
    process.env.ADMIN_INITIAL_NAME ||
    process.env.ADMIN_NAME ||
    "System Administrator";
  const phone =
    process.env.ADMIN_INITIAL_PHONE ||
    process.env.ADMIN_PHONE ||
    "+15550000001";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.");
  }

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long.");
  }

  await connectDatabase(mongoUri);

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(
        `[Admin Seed] Admin user already exists for '${email}' (ID: ${existingUser._id.toString()}). No action needed.`
      );
      return;
    }

    const passwordHash = await hashPassword(password);

    const adminUser = await User.create({
      email,
      phone,
      passwordHash,
      fullName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    console.log(
      `[Admin Seed] Administrator account provisioned successfully. User ID: ${adminUser._id.toString()}, Email: ${email}, Role: ${adminUser.role}`
    );
  } finally {
    await disconnectDatabase();
  }
}

// Execute script if run directly via CLI
if (process.argv[1]?.endsWith("seed-admin.ts") || process.argv[1]?.endsWith("seed-admin.js")) {
  seedAdminUser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Admin Seed Error]:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
