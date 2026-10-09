import mongoose from "mongoose";
import {
  User,
  PatientProfile,
  DoctorProfile,
  PharmacyProfile,
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
} from "../models/index.js";
import { tokenService, type TokenPair } from "./token.service.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { AppError } from "../utils/api-error.js";
import type { RegisterInput, LoginInput } from "../validators/auth.validator.js";

export interface RegisterResult {
  userId: string;
  email: string;
  role: string;
  status: string;
}

export interface LoginResult {
  tokens: TokenPair;
  user: {
    id: string;
    email: string;
    role: string;
    fullName: string;
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    role: string;
  };
}

/**
 * Authentication and identity management service.
 * Handles atomic registration, credential validation, token rotation, and logout.
 */
export class AuthService {
  /**
   * Registers a new user and creates their role-specific skeleton profile atomically.
   */
  public async register(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const phone = input.phone.trim();

    // 1. Check for duplicate email
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      throw AppError.conflict(
        "Provided email address is already in use",
        "AUTH_EMAIL_ALREADY_EXISTS"
      );
    }

    // 2. Check for duplicate phone
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      throw AppError.conflict(
        "Provided phone number is already registered",
        "AUTH_PHONE_ALREADY_EXISTS"
      );
    }

    // 3. Hash password using bcrypt (12 rounds)
    const passwordHash = await hashPassword(input.password);

    // Initial status: PENDING_VERIFICATION per API contract
    const status = UserStatus.PENDING_VERIFICATION;

    // 4. Perform atomic creation with transaction/session support on replica sets,
    // or atomic fallback with application-level rollback cleanup on standalone deployments.
    let isReplicaSet = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const client = mongoose.connection.getClient();
        const topology = (
          client as unknown as {
            topology?: { description?: { type?: string; setName?: string } };
          }
        )?.topology?.description;

        isReplicaSet =
          topology?.type === "ReplicaSetWithPrimary" ||
          topology?.type === "Sharded" ||
          Boolean(topology?.setName);
      } catch {
        isReplicaSet = false;
      }
    }

    let session: mongoose.ClientSession | undefined = undefined;

    if (isReplicaSet) {
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        session = undefined;
      }
    }

    let createdUserId: mongoose.Types.ObjectId | undefined;
    let createdProfileId: mongoose.Types.ObjectId | undefined;
    let createdProfileModel: typeof PatientProfile | typeof DoctorProfile | typeof PharmacyProfile | undefined;

    try {
      // Step A: Create User
      const [user] = await User.create(
        [
          {
            email: normalizedEmail,
            phone,
            passwordHash,
            fullName: input.fullName.trim(),
            role: input.role as UserRole,
            status,
          },
        ],
        session ? { session } : {}
      );

      createdUserId = user._id;

      // Step B: Create Role-specific Skeleton Profile
      if (input.role === "PATIENT") {
        createdProfileModel = PatientProfile;
        const [profile] = await PatientProfile.create(
          [
            {
              userId: user._id,
            },
          ],
          session ? { session } : {}
        );
        createdProfileId = profile._id;
        user.patientProfile = profile._id;
      } else if (input.role === "DOCTOR") {
        createdProfileModel = DoctorProfile;
        const [profile] = await DoctorProfile.create(
          [
            {
              userId: user._id,
              specialization: "GENERAL_MEDICINE",
              qualifications: ["MBBS"],
              experienceYears: 0,
              registrationNumber: `REG-${user._id.toString().slice(-8).toUpperCase()}`,
              registrationCouncil: "PENDING_VERIFICATION",
              consultationFee: 0,
              verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
            },
          ],
          session ? { session } : {}
        );
        createdProfileId = profile._id;
        user.doctorProfile = profile._id;
      } else if (input.role === "PHARMACY") {
        createdProfileModel = PharmacyProfile;
        const [profile] = await PharmacyProfile.create(
          [
            {
              userId: user._id,
              pharmacyName: `${user.fullName}'s Pharmacy`,
              ownerName: user.fullName,
              licenseNumber: `LIC-${user._id.toString().slice(-8).toUpperCase()}`,
              address: {
                city: "PENDING",
                state: "PENDING",
                postalCode: "000000",
                country: "India",
              },
              phone: user.phone,
              verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
            },
          ],
          session ? { session } : {}
        );
        createdProfileId = profile._id;
        user.pharmacyProfile = profile._id;
      }

      // Step C: Link profile to user
      await user.save(session ? { session } : {});

      // Commit transaction if active
      if (session && session.inTransaction()) {
        await session.commitTransaction();
      }

      return {
        userId: user.id || user._id.toString(),
        email: user.email,
        role: user.role,
        status: user.status,
      };
    } catch (error) {
      // Rollback transaction if active
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      } else {
        // Fallback rollback cleanup if running on standalone MongoDB without replica set
        if (createdProfileId && createdProfileModel) {
          try {
            await (createdProfileModel as any).findByIdAndDelete(createdProfileId);
          } catch {
            // ignore cleanup errors
          }
        }
        if (createdUserId) {
          try {
            await User.findByIdAndDelete(createdUserId);
          } catch {
            // ignore cleanup errors
          }
        }
      }
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  /**
   * Authenticates user credentials, returning user context and issued tokens.
   */
  public async login(input: LoginInput): Promise<LoginResult> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Find user with passwordHash explicitly projected
    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");

    // Unified 401 error prevents user account enumeration
    if (!user || !user.passwordHash) {
      throw AppError.unauthorized("Invalid email or password", "AUTH_INVALID_CREDENTIALS");
    }

    // Verify bcrypt password hash (constant-time)
    const isPasswordValid = await comparePassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Invalid email or password", "AUTH_INVALID_CREDENTIALS");
    }

    // Reject suspended accounts
    if (user.status === UserStatus.SUSPENDED) {
      throw AppError.forbidden(
        "Account has been suspended. Please contact support.",
        "AUTH_ACCOUNT_SUSPENDED"
      );
    }

    // Generate JWT access token and refresh token family
    const tokens = await tokenService.generateTokens({
      userId: user._id,
      role: user.role,
    });

    // Record last login timestamp
    user.lastLoginAt = new Date();
    await user.save();

    return {
      tokens,
      user: {
        id: user.id || user._id.toString(),
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
    };
  }

  /**
   * Rotates a refresh token via the existing TokenService.
   */
  public async refreshToken(rawRefreshToken: string): Promise<RefreshResult> {
    if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
      throw AppError.unauthorized("Refresh token is required", "AUTH_TOKEN_MISSING");
    }

    const rotationResult = await tokenService.rotateRefreshToken(rawRefreshToken);

    return {
      accessToken: rotationResult.accessToken,
      refreshToken: rotationResult.refreshToken,
      user: rotationResult.user,
    };
  }

  /**
   * Logs out user by revoking the refresh token in the database.
   */
  public async logout(rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken && typeof rawRefreshToken === "string") {
      await tokenService.revokeToken(rawRefreshToken);
    }
  }
}

export const authService = new AuthService();
