import type { Server as SocketIOServer, Socket } from "socket.io";
import { chatService, type FormattedChatMessage } from "../../services/chat.service.js";
import { AppError } from "../../utils/api-error.js";

export interface SocketChatResponse {
  success: boolean;
  data?: FormattedChatMessage;
  error?: string;
  code?: string;
}

/**
 * Handles the `send_message` Socket.IO event.
 *
 * Sequence:
 * 1. Requires authenticated socket context (socket.user).
 * 2. Validates incoming payload format.
 * 3. Authorizes sender against MongoDB consultation & checks chat window.
 * 4. Sanitizes HTML/script markup.
 * 5. Persists message to MongoDB.
 * 6. Broadcasts persisted message to `consultation:<id>` room.
 * 7. Invokes acknowledgement callback with persisted data.
 */
export async function handleSendMessage(
  io: SocketIOServer,
  socket: Socket,
  payload: unknown,
  callback?: (response: SocketChatResponse) => void
): Promise<void> {
  const sendCallback = (res: SocketChatResponse): void => {
    if (typeof callback === "function") {
      try {
        callback(res);
      } catch {}
    }
  };

  const user = socket.user;
  if (!user || !user.id) {
    sendCallback({
      success: false,
      error: "Authentication required",
      code: "SOCKET_AUTHENTICATION_FAILED",
    });
    return;
  }

  // 1. Validate payload structure
  if (!payload || typeof payload !== "object") {
    sendCallback({
      success: false,
      error: "Invalid request payload",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  const { consultationId, text, clientMessageId } = payload as {
    consultationId?: unknown;
    text?: unknown;
    clientMessageId?: unknown;
  };

  if (!consultationId || typeof consultationId !== "string" || !consultationId.trim()) {
    sendCallback({
      success: false,
      error: "Consultation ID is required",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (!/^[0-9a-fA-F]{24}$/.test(consultationId.trim())) {
    sendCallback({
      success: false,
      error: "Invalid consultation identifier format",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (typeof text !== "string") {
    sendCallback({
      success: false,
      error: "Message text must be a string",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    // 2. Authorize, sanitize, and persist via ChatService
    const persistedMessage = await chatService.sendMessage(user, {
      consultationId: consultationId.trim(),
      text,
      clientMessageId:
        typeof clientMessageId === "string" ? clientMessageId.trim() : undefined,
    });

    // 3. Broadcast to the authorized consultation room
    const targetRoom = `consultation:${persistedMessage.consultationId}`;
    io.to(targetRoom).emit("new_message", persistedMessage);

    // 4. Return success acknowledgement to sender
    sendCallback({
      success: true,
      data: persistedMessage,
    });
  } catch (error: unknown) {
    if (error instanceof AppError) {
      sendCallback({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    sendCallback({
      success: false,
      error: "Failed to send message",
      code: "INTERNAL_SERVER_ERROR",
    });
  }
}

/**
 * Registers chat socket event listeners for an authenticated socket connection.
 */
export function registerChatHandlers(io: SocketIOServer, socket: Socket): void {
  socket.on(
    "send_message",
    async (payload: unknown, callback?: (res: SocketChatResponse) => void) => {
      await handleSendMessage(io, socket, payload, callback);
    }
  );
}
