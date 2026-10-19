import { Track } from "livekit-client";
import {
  useTracks,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import {
  Mic,
  MicOff,
  VideoOff,
  User,
  Monitor,
  Volume2,
  Stethoscope,
  HeartPulse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/types/auth";

export interface VideoGridProps {
  doctorName?: string;
  patientName?: string;
  userRole?: UserRole;
}

/**
 * Responsive, accessible video grid for LiveKit video consultations.
 * Handles local self-view, remote participant tracks, screen sharing, and camera-off placeholders.
 */
export function VideoGrid({ doctorName, patientName, userRole }: VideoGridProps) {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const participants = useParticipants();

  // Query both camera and screen-share tracks across all room participants
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  // Identify active screen-share track if present
  const screenShareTrack = tracks.find(
    (t) => t.source === Track.Source.ScreenShare && t.publication?.isSubscribed !== false
  );

  // Remote participants excluding local participant
  const remoteParticipants = participants.filter((p) => !p.isLocal);

  // Remote camera track references
  const remoteCameraTracks = tracks.filter(
    (t) => !t.participant.isLocal && t.source === Track.Source.Camera
  );

  // Local camera track reference
  const localCameraTrack = tracks.find(
    (t) => t.participant.isLocal && t.source === Track.Source.Camera
  );

  return (
    <div
      className="relative flex-1 w-full h-full min-h-[360px] bg-slate-950 p-3 sm:p-4 rounded-2xl overflow-hidden flex flex-col justify-center items-center gap-3"
      data-testid="video-grid"
      role="region"
      aria-label="Consultation Video Room Grid"
    >
      {/* SCREEN SHARE ACTIVE VIEW */}
      {screenShareTrack ? (
        <div className="w-full h-full flex flex-col gap-3">
          <div
            className="relative flex-1 w-full bg-black rounded-xl overflow-hidden border border-primary/30 flex items-center justify-center shadow-xl"
            data-testid="screen-share-tile"
          >
            {screenShareTrack.publication?.track ? (
              <VideoTrack
                trackRef={screenShareTrack}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-6">
                <Monitor className="size-12 mb-2 text-primary animate-pulse" />
                <p className="text-sm font-medium">Loading shared screen...</p>
              </div>
            )}
            <div className="absolute top-3 left-3 bg-slate-900/85 backdrop-blur-md px-3 py-1 rounded-full border border-slate-700/60 flex items-center gap-1.5 shadow-md">
              <Monitor className="size-3.5 text-primary" />
              <span className="text-xs text-white font-medium">
                Screen Shared by {screenShareTrack.participant.name || screenShareTrack.participant.identity}
              </span>
            </div>
          </div>

          {/* Filmstrip for participants during screen share */}
          <div className="h-28 sm:h-36 flex items-center gap-3 overflow-x-auto pb-1">
            {/* Local Preview Tile */}
            <ParticipantTile
              trackRef={localCameraTrack}
              isLocal={true}
              name={localParticipant.name || "You"}
              role={userRole}
              isCameraOn={isCameraEnabled}
              isMicOn={isMicrophoneEnabled}
              isSpeaking={localParticipant.isSpeaking}
              compact={true}
            />

            {/* Remote Participants */}
            {remoteParticipants.length === 0 ? (
              <div className="h-full flex-1 max-w-xs bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-center p-3 text-center">
                <span className="text-xs text-slate-400">Waiting for other participant...</span>
              </div>
            ) : (
              remoteCameraTracks.map((trackRef) => (
                <ParticipantTile
                  key={trackRef.participant.identity}
                  trackRef={trackRef}
                  isLocal={false}
                  name={trackRef.participant.name || trackRef.participant.identity}
                  role={userRole === "DOCTOR" ? "PATIENT" : "DOCTOR"}
                  isCameraOn={trackRef.publication?.isEnabled && !trackRef.publication?.isMuted}
                  isMicOn={trackRef.participant.isMicrophoneEnabled}
                  isSpeaking={trackRef.participant.isSpeaking}
                  compact={true}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        /* STANDARD 1-ON-1 / MULTI-PARTICIPANT GRID */
        <div
          className={`w-full h-full grid gap-3 sm:gap-4 ${
            remoteParticipants.length === 0
              ? "grid-cols-1 max-w-3xl"
              : remoteParticipants.length === 1
              ? "grid-cols-1 md:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {/* LOCAL PARTICIPANT TILE */}
          <ParticipantTile
            trackRef={localCameraTrack}
            isLocal={true}
            name={localParticipant.name || "You"}
            role={userRole}
            isCameraOn={isCameraEnabled}
            isMicOn={isMicrophoneEnabled}
            isSpeaking={localParticipant.isSpeaking}
            doctorName={userRole === "DOCTOR" ? doctorName : undefined}
            patientName={userRole === "PATIENT" ? patientName : undefined}
          />

          {/* REMOTE PARTICIPANT TILES */}
          {remoteParticipants.length === 0 ? (
            <div
              className="relative w-full h-full min-h-[220px] bg-slate-900/60 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center p-6 text-center shadow-inner"
              data-testid="waiting-participant-placeholder"
            >
              <div className="size-16 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mb-3 text-slate-400">
                {userRole === "DOCTOR" ? (
                  <HeartPulse className="size-8 text-sky-400 animate-pulse" />
                ) : (
                  <Stethoscope className="size-8 text-emerald-400 animate-pulse" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-white">
                {userRole === "DOCTOR" ? "Waiting for Patient to Join" : "Waiting for Doctor to Connect"}
              </h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1">
                Your microphone and camera are active. The video consultation will connect as soon as the counterpart arrives.
              </p>
              <div className="mt-3">
                <Badge variant="outline" className="text-[11px] bg-slate-800/80 text-slate-300 border-slate-700">
                  Room Ready
                </Badge>
              </div>
            </div>
          ) : (
            remoteCameraTracks.map((trackRef) => (
              <ParticipantTile
                key={trackRef.participant.identity}
                trackRef={trackRef}
                isLocal={false}
                name={
                  trackRef.participant.name ||
                  (userRole === "DOCTOR"
                    ? patientName || "Patient"
                    : doctorName || "Attending Doctor")
                }
                role={userRole === "DOCTOR" ? "PATIENT" : "DOCTOR"}
                isCameraOn={Boolean(trackRef.publication?.isEnabled && !trackRef.publication?.isMuted)}
                isMicOn={trackRef.participant.isMicrophoneEnabled}
                isSpeaking={trackRef.participant.isSpeaking}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface ParticipantTileProps {
  trackRef?: TrackReferenceOrPlaceholder;
  isLocal: boolean;
  name: string;
  role?: string;
  isCameraOn?: boolean;
  isMicOn?: boolean;
  isSpeaking?: boolean;
  compact?: boolean;
  doctorName?: string;
  patientName?: string;
}

function ParticipantTile({
  trackRef,
  isLocal,
  name,
  role,
  isCameraOn,
  isMicOn,
  isSpeaking,
  compact = false,
  doctorName,
  patientName,
}: ParticipantTileProps) {
  const displayName =
    isLocal && role === "DOCTOR" && doctorName
      ? `Dr. ${doctorName} (You)`
      : isLocal && role === "PATIENT" && patientName
      ? `${patientName} (You)`
      : isLocal
      ? `${name} (You)`
      : name;

  const testId = isLocal ? "local-video-tile" : "remote-video-tile";

  return (
    <div
      className={`relative w-full h-full min-h-[180px] bg-slate-900 rounded-xl overflow-hidden border transition-all duration-200 flex items-center justify-center shadow-lg ${
        compact ? "min-w-[140px] max-w-[200px]" : ""
      } ${
        isSpeaking
          ? "border-emerald-500 ring-2 ring-emerald-500/30 shadow-emerald-950/40"
          : "border-slate-800"
      }`}
      data-testid={testId}
      aria-label={`${displayName} video feed`}
    >
      {/* VIDEO TRACK OR CAMERA-OFF PLACEHOLDER */}
      {isCameraOn && trackRef && trackRef.publication?.track ? (
        <VideoTrack
          trackRef={trackRef}
          className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-4">
          <div className="relative size-16 sm:size-20 rounded-full bg-slate-800 border-2 border-slate-700/80 flex items-center justify-center mb-2 shadow-inner">
            <User className="size-8 sm:size-10 text-slate-300" />
            <span className="absolute -bottom-1 -right-1 size-6 rounded-full bg-rose-600/90 text-white flex items-center justify-center border border-slate-900 shadow">
              <VideoOff className="size-3" />
            </span>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-slate-200 truncate max-w-[180px]">
            {displayName}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5">Camera is turned off</span>
        </div>
      )}

      {/* OVERLAY BADGE (NAME & ROLE) */}
      <div className="absolute bottom-2.5 left-2.5 max-w-[85%] bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/50 flex items-center gap-1.5 shadow-sm">
        <span className="text-xs font-medium text-white truncate max-w-[140px]">
          {displayName}
        </span>
        {role && (
          <Badge
            variant="outline"
            className={`text-[9px] px-1.5 py-0 uppercase tracking-wider font-bold ${
              role === "DOCTOR"
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/50"
                : "bg-sky-950/60 text-sky-300 border-sky-700/50"
            }`}
          >
            {role}
          </Badge>
        )}
      </div>

      {/* AUDIO STATUS INDICATOR */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
        {isSpeaking && (
          <span className="flex items-center gap-1 bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-xs animate-pulse">
            <Volume2 className="size-3" /> Speaking
          </span>
        )}
        <div
          className={`size-7 rounded-lg flex items-center justify-center backdrop-blur-md shadow-sm border ${
            isMicOn
              ? "bg-slate-950/75 border-slate-700/50 text-emerald-400"
              : "bg-rose-950/80 border-rose-700/60 text-rose-300"
          }`}
          data-testid={isLocal ? (isMicOn ? "local-mic-on" : "local-mic-muted") : (isMicOn ? "remote-mic-on" : "remote-mic-muted")}
          title={isMicOn ? "Microphone active" : "Microphone muted"}
        >
          {isMicOn ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
        </div>
      </div>
    </div>
  );
}
