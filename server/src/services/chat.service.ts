import mongoose from "mongoose";
import sanitizeHtml from "sanitize-html";
import { Consultation } from "../models/consultation.model.js";
import { Appointment } from "../models/appointment.model.js";
import { Message } from "../models/message.model.js";
import {
  ConsultationStatus,
  AppointmentStatus,
  UserRole,
  type IMessage,
  type IConsultation,
  type IAppointment,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";

export interface FormattedChatMessage {
  id: string;
  consultationId: string;
  senderId: string;
  senderRole: UserRole;
  text: string;
  clientMessageId?: string;
  createdAt: string;
}

export interface SendMessageInput {
  consultationId: string;
  text: string;
  clientMessageId?: string;
  now?: Date;
}

export interface GetChatHistoryOptions {
  limit?: number;
  before?: string;
  now?: Date;
}

export interface ChatHistoryResult {
  messages: FormattedChatMessage[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export class ChatService {
  /**
   * Formats a raw Mongoose Message document into a safe, client-facing message object.
   */
  public formatMessage(doc: IMessage): FormattedChatMessage {
    return {
      id: doc._id.toString(),
      consultationId: doc.consultationId.toString(),
      senderId: doc.senderId.toString(),
      senderRole: doc.senderRole,
      text: doc.text,
      clientMessageId: doc.clientMessageId,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /**
   * Sanitizes untrusted message text:
   * - Strips all executable HTML markup, scripts, and event handlers.
   * - Preserves ordinary text, multilingual characters, and emoji.
   * - Trims whitespace.
   * - Enforces non-empty and 2,000-character constraints.
   */
  public sanitizeMessageText(rawText: unknown): string {
    if (typeof rawText !== "string") {
      throw AppError.badRequest("Message text must be a string", "VALIDATION_ERROR");
    }

    // Strip all HTML tags, script contents, and dangerous attributes
    const cleanText = sanitizeHtml(rawText, {
      allowedTags: [],
      allowedAttributes: {},
      disallowedTagsMode: "discard",
    }).trim();

    if (cleanText.length === 0) {
      throw AppError.badRequest(
        "Message cannot be empty or contain only invalid markup",
        "VALIDATION_ERROR"
      );
    }

    if (cleanText.length > 2000) {
      throw new AppError(
        422,
        "CHAT_MESSAGE_TOO_LONG",
        "Message exceeds maximum character limit of 2000 characters"
      );
    }

    return cleanText;
  }

  /**
   * Validates whether chat is currently permitted based on the consultation time window:
   * Rule: Active from (scheduledStart - 15 minutes) through (completedAt + 24 hours).
   *
   * Rejects:
   * - Cancelled, rejected, or missed consultations
   * - Requests before scheduledStart - 15m
   * - Requests after completedAt + 24h
   */
  public validateChatWindow(
    consultation: IConsultation,
    appointment: IAppointment | null,
    now: Date = new Date()
  ): void {
    // 1. Check cancellation or rejection
    if (
      (consultation.status as string) === "CANCELLED" ||
      (consultation.status as string) === "MISSED" ||
      (appointment &&
        (appointment.status === AppointmentStatus.CANCELLED ||
          appointment.status === AppointmentStatus.REJECTED))
    ) {
      throw new AppError(
        403,
        "CHAT_ACCESS_DENIED",
        "Chat is not available for a cancelled or rejected consultation"
      );
    }

    // 2. Determine scheduled start timestamp
    const scheduledStart =
      appointment?.scheduledStart ||
      consultation.startedAt ||
      consultation.createdAt;

    const windowOpening = new Date(
      scheduledStart.getTime() - 15 * 60 * 1000
    );

    if (now.getTime() < windowOpening.getTime()) {
      throw new AppError(
        403,
        "CHAT_ACCESS_DENIED",
        "Chat is not active: consultation chat opens 15 minutes before scheduled start time"
      );
    }

    // 3. Determine completion closing boundary if completed
    if (consultation.status === ConsultationStatus.COMPLETED) {
      const completedAt = consultation.endedAt || consultation.updatedAt;
      const windowClosing = new Date(
        completedAt.getTime() + 24 * 60 * 60 * 1000
      );

      if (now.getTime() > windowClosing.getTime()) {
        throw new AppError(
          403,
          "CHAT_ACCESS_DENIED",
          "Chat is not active: consultation chat window closed 24 hours after completion"
        );
      }
    }
  }

  /**
   * Validates caller participation and consultation chat eligibility.
   * Ensures the caller is the assigned doctor or patient.
   */
  public async validateConsultationAccess(
    user: { id: string; role: UserRole },
    consultationId: string,
    now: Date = new Date()
  ): Promise<{ consultation: IConsultation; appointment: IAppointment | null }> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest(
        "Invalid consultation identifier format",
        "VALIDATION_ERROR"
      );
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    // Verify authorized participant (attending Doctor or Patient)
    const isPatient = consultation.patientId.toString() === user.id;
    const isDoctor = consultation.doctorId.toString() === user.id;

    if (!isPatient && !isDoctor) {
      throw new AppError(
        403,
        "CHAT_ACCESS_DENIED",
        "Access denied: you are not an authorized participant in this consultation chat"
      );
    }

    let appointment: IAppointment | null = null;
    if (consultation.appointmentId) {
      appointment = await Appointment.findById(consultation.appointmentId);
    }

    // Enforce chat window and lifecycle restrictions
    this.validateChatWindow(consultation, appointment, now);

    return { consultation, appointment };
  }

  /**
   * Persists a validated and sanitized chat message.
   */
  public async sendMessage(
    user: { id: string; role: UserRole },
    input: SendMessageInput
  ): Promise<FormattedChatMessage> {
    const now = input.now || new Date();

    // 1. Authorize participant and check chat window
    const { consultation } = await this.validateConsultationAccess(
      user,
      input.consultationId,
      now
    );

    // 2. Sanitize and validate message text
    const sanitizedText = this.sanitizeMessageText(input.text);

    // 3. Persist to MongoDB
    const messageDoc = await Message.create({
      consultationId: consultation._id,
      senderId: new mongoose.Types.ObjectId(user.id),
      senderRole: user.role,
      text: sanitizedText,
      ...(input.clientMessageId
        ? { clientMessageId: input.clientMessageId.trim() }
        : {}),
    });

    return this.formatMessage(messageDoc);
  }

  /**
   * Retrieves paginated chronological chat history for an authorized consultation.
   */
  public async getMessageHistory(
    user: { id: string; role: UserRole },
    consultationId: string,
    options: GetChatHistoryOptions = {}
  ): Promise<ChatHistoryResult> {
    const now = options.now || new Date();

    // 1. Authorize participant and check chat window
    const { consultation } = await this.validateConsultationAccess(
      user,
      consultationId,
      now
    );

    // 2. Validate and bounded pagination parameters
    let limit = 50;
    if (options.limit !== undefined) {
      if (typeof options.limit !== "number" || isNaN(options.limit) || options.limit < 1) {
        throw AppError.badRequest("Invalid limit parameter", "VALIDATION_ERROR");
      }
      if (options.limit > 100) {
        throw AppError.badRequest("Limit cannot exceed 100", "VALIDATION_ERROR");
      }
      limit = Math.floor(options.limit);
    }

    // 3. Build query with cursor filtering
    const query: Record<string, unknown> = {
      consultationId: consultation._id,
    };

    if (options.before) {
      const beforeCursor = options.before.trim();
      if (mongoose.Types.ObjectId.isValid(beforeCursor)) {
        const cursorDoc = await Message.findById(beforeCursor);
        if (cursorDoc) {
          query.$or = [
            { createdAt: { $lt: cursorDoc.createdAt } },
            {
              createdAt: cursorDoc.createdAt,
              _id: { $lt: cursorDoc._id },
            },
          ];
        } else {
          query._id = { $lt: new mongoose.Types.ObjectId(beforeCursor) };
        }
      } else {
        const parsedDate = new Date(beforeCursor);
        if (!isNaN(parsedDate.getTime())) {
          query.createdAt = { $lt: parsedDate };
        } else {
          throw AppError.badRequest("Invalid before cursor format", "VALIDATION_ERROR");
        }
      }
    }

    // 4. Query messages with stable tie-breaking: { createdAt: -1, _id: -1 }
    const rawDocs = await Message.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = rawDocs.length > limit;
    const pageDocs = hasMore ? rawDocs.slice(0, limit) : rawDocs;

    const nextCursor =
      hasMore && pageDocs.length > 0
        ? pageDocs[pageDocs.length - 1]._id.toString()
        : null;

    // Return in chronological order (oldest to newest)
    const chronologicalDocs = pageDocs.reverse();
    const messages = chronologicalDocs.map((doc) => this.formatMessage(doc));

    return {
      messages,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    };
  }
}

export const chatService = new ChatService();
