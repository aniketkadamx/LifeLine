import bcrypt from "bcryptjs";
import { AppError } from "./api-error.js";

/**
 * Standard bcrypt salt generation cost factor.
 * Set strictly to 12 rounds per platform security specification.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * Securely hashes a plaintext password using bcrypt with 12 salt rounds.
 *
 * @param password - Plaintext password to hash
 * @returns Promise resolving to the bcrypt password hash
 * @throws AppError if password is empty or invalid
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.trim().length === 0) {
    throw AppError.badRequest("Password must be a non-empty string", "VALIDATION_ERROR");
  }

  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Securely compares a candidate plaintext password with a stored bcrypt hash.
 * Constant-time comparison internally mitigates timing attacks.
 *
 * @param password - Candidate plaintext password
 * @param hash - Stored bcrypt password hash
 * @returns Promise resolving to true if matching, false otherwise
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (
    typeof password !== "string" ||
    typeof hash !== "string" ||
    password.length === 0 ||
    hash.length === 0
  ) {
    return false;
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // If the hash is malformed or invalid bcrypt format, safely return false
    return false;
  }
}
