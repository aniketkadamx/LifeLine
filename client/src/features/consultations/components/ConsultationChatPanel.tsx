import * as React from "react";
import { useChat } from "@livekit/components-react";
import {
  X,
  Send,
  MessageSquare,
  AlertCircle,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/types/auth";

export interface ConsultationChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  currentUserName?: string;
  userRole?: UserRole;
}

/**
 * Collapsible in-room consultation chat drawer powered by LiveKit WebRTC DataChannel.
 * Provides ephemeral peer-to-peer messaging with XSS protection and sender role labeling.
 */
export function ConsultationChatPanel({
  isOpen,
  onClose,
  currentUserId,
  currentUserName,
  userRole,
}: ConsultationChatPanelProps) {
  const { chatMessages, send, isSending } = useChat();
  const [inputText, setInputText] = React.useState("");
  const [sendError, setSendError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new incoming messages
  React.useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [chatMessages, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    const trimmed = inputText.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.length > 2000) {
      setSendError("Message exceeds maximum allowed length of 2,000 characters.");
      return;
    }

    try {
      setSendError(null);
      await send(trimmed);
      setInputText("");
    } catch (err: any) {
      const msg = err?.message || "Failed to send message over data channel.";
      setSendError(msg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div
      className="w-full sm:w-80 md:w-96 h-full flex flex-col bg-slate-900 border-l border-slate-800 shadow-2xl z-20 animate-in slide-in-from-right duration-200"
      data-testid="chat-panel"
      role="region"
      aria-label="In-Room Consultation Chat"
    >
      {/* CHAT HEADER */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 bg-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
            <MessageSquare className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Consultation Chat</h3>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LiveKit DataChannel
            </span>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="size-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          data-testid="close-chat-btn"
          aria-label="Close Chat"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* DISCLOSURE BANNER */}
      <div className="px-3.5 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-400">
        <ShieldCheck className="size-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          Real-time in-room messages are active during this consultation. Messages are ephemeral and not saved to persistent storage.
        </span>
      </div>

      {/* ERROR ALERT */}
      {sendError && (
        <div
          className="m-3 p-2.5 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-lg text-xs flex items-center gap-2"
          role="alert"
          data-testid="chat-error-alert"
        >
          <AlertCircle className="size-4 text-rose-400 shrink-0" />
          <span className="flex-1">{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            className="text-rose-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* MESSAGE STREAM */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3"
        data-testid="chat-messages-container"
      >
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <div className="size-12 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-2 text-slate-400">
              <MessageSquare className="size-6" />
            </div>
            <p className="text-xs font-medium text-slate-300">No Messages Yet</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">
              Send a text message to coordinate with clinician or patient during the call.
            </p>
          </div>
        ) : (
          chatMessages.map((msg, index) => {
            const isLocal =
              msg.from?.identity === currentUserId ||
              (msg.from?.name && currentUserName && msg.from.name === currentUserName);

            const timeStr = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";

            const senderLabel = isLocal
              ? userRole ? `You (${userRole})` : "You"
              : msg.from?.name || msg.from?.identity || "Participant";

            return (
              <div
                key={msg.id || `${msg.timestamp}-${index}`}
                className={`flex flex-col ${isLocal ? "items-end" : "items-start"}`}
                data-testid="chat-message-item"
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="text-[11px] font-semibold text-slate-300">
                    {senderLabel}
                  </span>
                  {timeStr && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                      <Clock className="size-2.5" />
                      {timeStr}
                    </span>
                  )}
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words shadow-sm ${
                    isLocal
                      ? "bg-primary text-primary-foreground rounded-tr-xs"
                      : "bg-slate-800 text-slate-100 border border-slate-700/60 rounded-tl-xs"
                  }`}
                >
                  {/* Render message as plain text to prevent XSS */}
                  <span className="whitespace-pre-wrap">{msg.message}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* MESSAGE INPUT DOCK */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 border-t border-slate-800 bg-slate-950/80 backdrop-blur-md flex items-center gap-2"
        data-testid="chat-form"
      >
        <Input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxLength={2000}
          disabled={isSending}
          className="bg-slate-900 border-slate-800 text-slate-100 placeholder:text-slate-500 text-xs h-10 focus-visible:ring-primary"
          data-testid="chat-input"
          aria-label="Chat message input"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!inputText.trim() || isSending}
          className="size-10 rounded-xl shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
          data-testid="send-chat-btn"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
