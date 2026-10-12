import mongoose from "mongoose";
import { PatientProfile } from "../models/patient-profile.model.js";
import { User } from "../models/user.model.js";
import { Appointment } from "../models/appointment.model.js";
import { AppointmentStatus, type IPatientProfile } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type { UpdatePatientProfileInput } from "../validators/patient.validator.js";

/**
 * Service managing patient health profile retrieval, updates,
 * and clinical doctor-patient relationship authorization.
 */
export class PatientService {
  /**
   * Retrieves a patient's own health profile by their user ID.
   */
  public async getProfileByUserId(userId: string): Promise<IPatientProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await PatientProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Patient profile not found", "NOT_FOUND");
    }

    return profile;
  }

  /**
   * Updates (or creates if missing) a patient's health profile.
   * Preserves any omitted fields to avoid unsafe partial-update data loss.
   */
  public async updateProfile(
    userId: string,
    input: UpdatePatientProfileInput
  ): Promise<IPatientProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw AppError.notFound("User not found", "USER_NOT_FOUND");
    }

    // Prepare update data only from supplied fields to prevent accidental field deletion
    const updateData: Record<string, unknown> = {};

    if (input.dateOfBirth !== undefined) {
      updateData.dateOfBirth = new Date(input.dateOfBirth);
    }
    if (input.gender !== undefined) {
      updateData.gender = input.gender;
    }
    if (input.bloodGroup !== undefined) {
      updateData.bloodGroup = input.bloodGroup;
    }
    if (input.allergies !== undefined) {
      updateData.allergies = input.allergies;
    }
    if (input.medicalConditions !== undefined) {
      updateData.medicalConditions = input.medicalConditions;
    }
    if (input.currentMedications !== undefined) {
      updateData.currentMedications = input.currentMedications;
    }
    if (input.emergencyContact !== undefined) {
      updateData.emergencyContact = input.emergencyContact;
    }

    const profile = await PatientProfile.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $set: updateData },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    // Keep User reference updated
    if (!user.patientProfile || !user.patientProfile.equals(profile._id)) {
      user.patientProfile = profile._id;
      await user.save();
    }

    return profile;
  }

  /**
   * Verifies if an active clinical relationship exists between a doctor and patient.
   * Per AUTHORIZATION_MATRIX.md: Requires an active, scheduled, in-progress, or completed appointment.
   */
  public async hasDoctorPatientRelationship(
    doctorUserId: string,
    patientIdentifier: string
  ): Promise<boolean> {
    if (
      !mongoose.Types.ObjectId.isValid(doctorUserId) ||
      !mongoose.Types.ObjectId.isValid(patientIdentifier)
    ) {
      return false;
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorUserId);
    const patientObjectId = new mongoose.Types.ObjectId(patientIdentifier);

    // Resolve patient user ID whether given as a patient User ID or PatientProfile ID
    let patientUserId = patientObjectId;
    const profile = await PatientProfile.findOne({
      $or: [{ userId: patientObjectId }, { _id: patientObjectId }],
    });

    if (profile) {
      patientUserId = profile.userId;
    }

    const appointment = await Appointment.findOne({
      doctorId: doctorObjectId,
      patientId: patientUserId,
      status: {
        $in: [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.IN_PROGRESS,
          AppointmentStatus.COMPLETED,
        ],
      },
    });

    return Boolean(appointment);
  }

  /**
   * Retrieves a patient profile on behalf of a doctor, verifying authorized clinical relationship.
   */
  public async getProfileForDoctor(
    doctorUserId: string,
    patientIdentifier: string
  ): Promise<IPatientProfile> {
    if (!mongoose.Types.ObjectId.isValid(patientIdentifier)) {
      throw AppError.badRequest("Invalid patient identifier format", "BAD_REQUEST");
    }

    const patientObjectId = new mongoose.Types.ObjectId(patientIdentifier);
    const profile = await PatientProfile.findOne({
      $or: [{ userId: patientObjectId }, { _id: patientObjectId }],
    });

    if (!profile) {
      throw AppError.notFound("Patient profile not found", "NOT_FOUND");
    }

    const hasRelationship = await this.hasDoctorPatientRelationship(
      doctorUserId,
      profile.userId.toString()
    );

    if (!hasRelationship) {
      throw AppError.forbidden(
        "Access denied: doctor does not have an active clinical relationship with this patient",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    return profile;
  }
}

export const patientService = new PatientService();
