import http from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { socketAuthMiddleware, type SocketUser } from "./middlewares/auth.socket.js";
import { Appointment } from "../models/appointment.model.js";
import { Consultation } from "../models/consultation.model.js";
import { AppointmentStatus, UserRole } from "../types/models.js";

export interface RoomJoinResponse {
  success: boolean;
  room?: string;
  error?: string;
}

let ioInstance: SocketIOServer | null = null;

/**
 * Handles database-backed authorization for joining scoped rooms.
 *
 * Supported Room Patterns:
 * - `consultation:<24-hex-id>`: Allowed for attending Doctor and attending Patient.
 * - `appointment:<24-hex-id>`: Allowed for attending Doctor and attending Patient.
 *
 * Rejects:
 * - Arbitrary or unmapped room names
 * - Non-existent resources
 * - Cross-patient or cross-doctor unauthorized access
 * - Cancelled or rejected appointments
 */
export async function handleJoinRoom(
  socket: Socket,
  data: unknown,
  callback?: (res: RoomJoinResponse) => void
): Promise<void> {
  const sendCallback = (res: RoomJoinResponse): void => {
    if (typeof callback === "function") {
      try {
        callback(res);
      } catch {}
    }
  };

  const user = socket.user;
  if (!user || !user.id) {
    sendCallback({ success: false, error: "Authentication required" });
    return;
  }

  // Extract room name
  let roomName: string | undefined;
  if (typeof data === "string") {
    roomName = data.trim();
  } else if (
    data &&
    typeof data === "object" &&
    "room" in data &&
    typeof (data as { room: unknown }).room === "string"
  ) {
    roomName = (data as { room: string }).room.trim();
  }

  if (!roomName) {
    sendCallback({ success: false, error: "Room name is required" });
    return;
  }

  // Parse room name format
  const colonIndex = roomName.indexOf(":");
  if (colonIndex === -1) {
    sendCallback({
      success: false,
      error: "Invalid or unsupported room format",
    });
    return;
  }

  const roomType = roomName.slice(0, colonIndex).trim();
  const resourceId = roomName.slice(colonIndex + 1).trim();

  // Validate supported room types
  if (roomType !== "consultation" && roomType !== "appointment") {
    sendCallback({ success: false, error: "Unsupported room type" });
    return;
  }

  // Validate 24-character hex ObjectId format
  if (!mongoose.Types.ObjectId.isValid(resourceId)) {
    sendCallback({
      success: false,
      error: "Invalid resource identifier format",
    });
    return;
  }

  try {
    // 1. Consultation Room Authorization
    if (roomType === "consultation") {
      const consultation = await Consultation.findById(resourceId);
      if (!consultation) {
        sendCallback({ success: false, error: "Consultation not found" });
        return;
      }

      const isPatient = consultation.patientId.toString() === user.id;
      const isDoctor = consultation.doctorId.toString() === user.id;

      if (!isPatient && !isDoctor) {
        sendCallback({
          success: false,
          error: "Access denied: you are not a participant in this consultation",
        });
        return;
      }

      // Check appointment status if linked
      if (consultation.appointmentId) {
        const appointment = await Appointment.findById(
          consultation.appointmentId
        );
        if (
          appointment &&
          (appointment.status === AppointmentStatus.CANCELLED ||
            appointment.status === AppointmentStatus.REJECTED)
        ) {
          sendCallback({
            success: false,
            error:
              "Cannot join consultation room for a cancelled or rejected appointment",
          });
          return;
        }
      }

      const canonicalRoom = `consultation:${consultation._id.toString()}`;
      await socket.join(canonicalRoom);
      sendCallback({ success: true, room: canonicalRoom });
      return;
    }

    // 2. Appointment Room Authorization
    if (roomType === "appointment") {
      const appointment = await Appointment.findById(resourceId);
      if (!appointment) {
        sendCallback({ success: false, error: "Appointment not found" });
        return;
      }

      const isPatient = appointment.patientId.toString() === user.id;
      const isDoctor = appointment.doctorId.toString() === user.id;

      if (!isPatient && !isDoctor) {
        sendCallback({
          success: false,
          error: "Access denied: you are not a participant in this appointment",
        });
        return;
      }

      if (
        appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.REJECTED
      ) {
        sendCallback({
          success: false,
          error:
            "Cannot join appointment room for a cancelled or rejected appointment",
        });
        return;
      }

      const canonicalRoom = `appointment:${appointment._id.toString()}`;
      await socket.join(canonicalRoom);
      sendCallback({ success: true, room: canonicalRoom });
      return;
    }
  } catch (error: unknown) {
    sendCallback({ success: false, error: "Room authorization failed" });
  }
}

/**
 * Handles leaving a previously joined room.
 */
export function handleLeaveRoom(
  socket: Socket,
  data: unknown,
  callback?: (res: RoomJoinResponse) => void
): void {
  let roomName: string | undefined;
  if (typeof data === "string") {
    roomName = data.trim();
  } else if (
    data &&
    typeof data === "object" &&
    "room" in data &&
    typeof (data as { room: unknown }).room === "string"
  ) {
    roomName = (data as { room: string }).room.trim();
  }

  if (roomName) {
    socket.leave(roomName);
    if (typeof callback === "function") {
      callback({ success: true, room: roomName });
    }
  } else if (typeof callback === "function") {
    callback({ success: false, error: "Room name is required" });
  }
}

/**
 * Initializes and configures the Socket.IO server attached to the HTTP server.
 * Idempotent: returns existing instance if already initialized.
 */
export function initSocketServer(httpServer: http.Server): SocketIOServer {
  if (ioInstance) {
    return ioInstance;
  }

  ioInstance = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  // Attach handshake authentication middleware
  ioInstance.use(socketAuthMiddleware);

  // Connection and room authorization handlers
  ioInstance.on("connection", (socket: Socket) => {
    const user = socket.user;
    if (user && user.id) {
      // Automatically bind trusted user-specific channels
      socket.join(`user:${user.id}`);
      if (user.role === UserRole.PATIENT) {
        socket.join(`patient:${user.id}`);
      } else if (user.role === UserRole.DOCTOR) {
        socket.join(`doctor:${user.id}`);
      } else if (user.role === UserRole.PHARMACY) {
        socket.join(`pharmacy:${user.id}`);
      }
    }

    // Room join events
    socket.on(
      "join_room",
      async (data: unknown, callback?: (res: RoomJoinResponse) => void) => {
        await handleJoinRoom(socket, data, callback);
      }
    );

    socket.on(
      "join",
      async (data: unknown, callback?: (res: RoomJoinResponse) => void) => {
        await handleJoinRoom(socket, data, callback);
      }
    );

    // Room leave events
    socket.on(
      "leave_room",
      (data: unknown, callback?: (res: RoomJoinResponse) => void) => {
        handleLeaveRoom(socket, data, callback);
      }
    );

    socket.on(
      "leave",
      (data: unknown, callback?: (res: RoomJoinResponse) => void) => {
        handleLeaveRoom(socket, data, callback);
      }
    );

    socket.on("disconnect", () => {
      // Disconnect cleanup: socket is automatically removed from all rooms by Socket.IO
    });
  });

  return ioInstance;
}

/**
 * Retrieves the active Socket.IO server instance.
 */
export function getIO(): SocketIOServer {
  if (!ioInstance) {
    throw new Error(
      "Socket.IO has not been initialized. Call initSocketServer first."
    );
  }
  return ioInstance;
}

/**
 * Closes the Socket.IO server and resets singleton instance.
 */
export async function closeSocketServer(): Promise<void> {
  if (ioInstance) {
    await new Promise<void>((resolve) => {
      ioInstance!.close(() => {
        ioInstance = null;
        resolve();
      });
    });
  }
}
