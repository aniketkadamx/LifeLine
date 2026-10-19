import * as React from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorOff,
  MessageSquare,
  PhoneOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export interface MediaControlsProps {
  onEndConsultation: () => Promise<void> | void;
  isEnding?: boolean;
  isChatOpen: boolean;
  onToggleChat: () => void;
  unreadChatCount?: number;
}

/**
 * Bottom control dock for in-room WebRTC consultation media management.
 * Coordinates local audio, video, screen share, chat drawer toggle, and end session confirmation.
 */
export function MediaControls({
  onEndConsultation,
  isEnding = false,
  isChatOpen,
  onToggleChat,
  unreadChatCount = 0,
}: MediaControlsProps) {
  const {
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    localParticipant,
  } = useLocalParticipant();

  const [confirmEndOpen, setConfirmEndOpen] = React.useState(false);
  const [deviceError, setDeviceError] = React.useState<string | null>(null);
  const [isTogglingMic, setIsTogglingMic] = React.useState(false);
  const [isTogglingCamera, setIsTogglingCamera] = React.useState(false);
  const [isTogglingScreen, setIsTogglingScreen] = React.useState(false);

  // Toggle Microphone
  const handleToggleMic = async () => {
    try {
      setDeviceError(null);
      setIsTogglingMic(true);
      if (localParticipant) {
        await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to toggle microphone";
      setDeviceError(msg);
    } finally {
      setIsTogglingMic(false);
    }
  };

  // Toggle Camera
  const handleToggleCamera = async () => {
    try {
      setDeviceError(null);
      setIsTogglingCamera(true);
      if (localParticipant) {
        await localParticipant.setCameraEnabled(!isCameraEnabled);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to toggle camera";
      setDeviceError(msg);
    } finally {
      setIsTogglingCamera(false);
    }
  };

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    try {
      setDeviceError(null);
      setIsTogglingScreen(true);

      // Verify browser support for screen sharing
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getDisplayMedia !== "function"
      ) {
        setDeviceError("Screen sharing is not supported by your current browser environment.");
        return;
      }

      if (localParticipant) {
        await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
      }
    } catch (err: any) {
      // Ignore user cancellation in browser picker
      if (err?.name !== "NotAllowedError") {
        const msg = err?.message || "Failed to toggle screen sharing";
        setDeviceError(msg);
      }
    } finally {
      setIsTogglingScreen(false);
    }
  };

  const handleConfirmEnd = async () => {
    setConfirmEndOpen(false);
    await onEndConsultation();
  };

  return (
    <div
      className="w-full flex flex-col items-center gap-2 pt-1"
      data-testid="media-controls"
      role="toolbar"
      aria-label="Consultation Media Controls"
    >
      {/* DEVICE ERROR ALERT BANNER */}
      {deviceError && (
        <div
          className="w-full max-w-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs px-3 py-1.5 rounded-lg flex items-center justify-between shadow-sm animate-in fade-in"
          role="alert"
          data-testid="media-controls-error"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-rose-400" />
            <span>{deviceError}</span>
          </div>
          <button
            type="button"
            onClick={() => setDeviceError(null)}
            className="text-rose-400 hover:text-white text-xs font-semibold px-1"
            aria-label="Dismiss media error"
          >
            ✕
          </button>
        </div>
      )}

      {/* CONTROLS DOCK */}
      <div className="flex items-center justify-center gap-2 sm:gap-3 bg-slate-900/90 backdrop-blur-xl px-4 py-2.5 rounded-2xl border border-slate-800 shadow-2xl">
        {/* MICROPHONE TOGGLE */}
        <Button
          type="button"
          size="icon"
          variant={isMicrophoneEnabled ? "secondary" : "destructive"}
          onClick={handleToggleMic}
          disabled={isTogglingMic || isEnding}
          className={`size-11 rounded-xl transition-all ${
            isMicrophoneEnabled
              ? "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/40"
          }`}
          data-testid="toggle-mic-btn"
          aria-label={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
          title={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
        >
          {isTogglingMic ? (
            <Loader2 className="size-5 animate-spin" />
          ) : isMicrophoneEnabled ? (
            <Mic className="size-5" />
          ) : (
            <MicOff className="size-5" />
          )}
        </Button>

        {/* CAMERA TOGGLE */}
        <Button
          type="button"
          size="icon"
          variant={isCameraEnabled ? "secondary" : "destructive"}
          onClick={handleToggleCamera}
          disabled={isTogglingCamera || isEnding}
          className={`size-11 rounded-xl transition-all ${
            isCameraEnabled
              ? "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/40"
          }`}
          data-testid="toggle-camera-btn"
          aria-label={isCameraEnabled ? "Turn Off Camera" : "Turn On Camera"}
          title={isCameraEnabled ? "Turn Off Camera" : "Turn On Camera"}
        >
          {isTogglingCamera ? (
            <Loader2 className="size-5 animate-spin" />
          ) : isCameraEnabled ? (
            <Video className="size-5" />
          ) : (
            <VideoOff className="size-5" />
          )}
        </Button>

        {/* SCREEN SHARE TOGGLE */}
        <Button
          type="button"
          size="icon"
          variant={isScreenShareEnabled ? "default" : "secondary"}
          onClick={handleToggleScreenShare}
          disabled={isTogglingScreen || isEnding}
          className={`size-11 rounded-xl transition-all ${
            isScreenShareEnabled
              ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/40"
              : "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
          }`}
          data-testid="toggle-screen-share-btn"
          aria-label={isScreenShareEnabled ? "Stop Sharing Screen" : "Share Screen"}
          title={isScreenShareEnabled ? "Stop Sharing Screen" : "Share Screen"}
        >
          {isTogglingScreen ? (
            <Loader2 className="size-5 animate-spin" />
          ) : isScreenShareEnabled ? (
            <MonitorOff className="size-5" />
          ) : (
            <MonitorUp className="size-5" />
          )}
        </Button>

        {/* CHAT DRAWER TOGGLE */}
        <div className="relative">
          <Button
            type="button"
            size="icon"
            variant={isChatOpen ? "default" : "secondary"}
            onClick={onToggleChat}
            disabled={isEnding}
            className={`size-11 rounded-xl transition-all ${
              isChatOpen
                ? "bg-primary text-primary-foreground shadow-primary/30"
                : "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
            }`}
            data-testid="toggle-chat-btn"
            aria-label={isChatOpen ? "Close Chat" : "Open Chat"}
            title={isChatOpen ? "Close Chat" : "Open Chat"}
          >
            <MessageSquare className="size-5" />
          </Button>

          {/* Unread Message Badge */}
          {!isChatOpen && unreadChatCount > 0 && (
            <span
              className="absolute -top-1 -right-1 size-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-slate-900 shadow-md animate-bounce"
              data-testid="unread-chat-badge"
            >
              {unreadChatCount > 9 ? "9+" : unreadChatCount}
            </span>
          )}
        </div>

        {/* DIVIDER */}
        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* END CONSULTATION BUTTON */}
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirmEndOpen(true)}
          disabled={isEnding}
          className="h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center gap-2 shadow-lg shadow-rose-950/50"
          data-testid="end-consultation-btn"
          aria-label="End Consultation"
        >
          {isEnding ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span className="hidden sm:inline">Ending...</span>
            </>
          ) : (
            <>
              <PhoneOff className="size-4.5" />
              <span className="hidden sm:inline">End Call</span>
            </>
          )}
        </Button>
      </div>

      {/* CONFIRM END CONSULTATION DIALOG */}
      <Dialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <DialogContent
          className="max-w-md bg-slate-900 border-slate-800 text-slate-100 shadow-2xl"
          data-testid="confirm-end-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <PhoneOff className="size-5 text-rose-500" />
              End Video Consultation?
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm mt-1.5">
              This will disconnect the live video room for all participants and conclude the call session.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmEndOpen(false)}
              className="border-slate-700 text-slate-200 hover:bg-slate-800"
              data-testid="cancel-end-btn"
            >
              Continue Call
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmEnd}
              disabled={isEnding}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              data-testid="confirm-end-btn"
            >
              {isEnding ? "Ending..." : "Yes, End Consultation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
