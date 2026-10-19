import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import {
  ConsultationRoomPage,
  resolveConsultationId,
  type ConsultationRecord,
  type ParticipantTokenResponse,
  type InitiateSessionResponse,
} from "@/features/consultations/pages/ConsultationRoomPage";
import { VideoGrid } from "@/features/consultations/components/VideoGrid";
import { MediaControls } from "@/features/consultations/components/MediaControls";
import { ConsultationChatPanel } from "@/features/consultations/components/ConsultationChatPanel";
import { AppRoutes } from "@/routes/AppRoutes";

// ---------------------------------------------------------------------------
// MOCK STATE FOR LIVEKIT COMPONENTS BOUNDARY
// ---------------------------------------------------------------------------
const mockSetMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
const mockSetCameraEnabled = vi.fn().mockResolvedValue(undefined);
const mockSetScreenShareEnabled = vi.fn().mockResolvedValue(undefined);
const mockSendChatMessage = vi.fn().mockResolvedValue({ message: "Hello Doctor" });

let mockLocalMicEnabled = true;
let mockLocalCameraEnabled = true;
let mockLocalScreenShareEnabled = false;
let mockChatMessages: any[] = [];
let mockParticipantsList: any[] = [];
let mockTracksList: any[] = [];

vi.mock("livekit-client", () => {
  return {
    Track: {
      Source: {
        Camera: "camera",
        Microphone: "microphone",
        ScreenShare: "screen_share",
        ScreenShareAudio: "screen_share_audio",
        Unknown: "unknown",
      },
    },
  };
});

vi.mock("@livekit/components-react", () => {
  return {
    LiveKitRoom: ({ children, onConnected }: any) => {
      React.useEffect(() => {
        if (onConnected) onConnected();
      }, [onConnected]);
      return <div data-testid="livekit-room-container">{children}</div>;
    },
    RoomAudioRenderer: () => <div data-testid="room-audio-renderer" />,
    VideoTrack: ({ trackRef, className }: any) => (
      <video
        data-testid="mock-video-track"
        data-source={trackRef?.source}
        data-participant={trackRef?.participant?.identity}
        className={className}
      />
    ),
    useTracks: () => mockTracksList,
    useParticipants: () => mockParticipantsList,
    useLocalParticipant: () => ({
      isMicrophoneEnabled: mockLocalMicEnabled,
      isCameraEnabled: mockLocalCameraEnabled,
      isScreenShareEnabled: mockLocalScreenShareEnabled,
      localParticipant: {
        identity: "mock-local-identity",
        name: "Dr. Gregory House",
        isSpeaking: false,
        isMicrophoneEnabled: mockLocalMicEnabled,
        isCameraEnabled: mockLocalCameraEnabled,
        setMicrophoneEnabled: mockSetMicrophoneEnabled,
        setCameraEnabled: mockSetCameraEnabled,
        setScreenShareEnabled: mockSetScreenShareEnabled,
      },
    }),
    useChat: () => ({
      chatMessages: mockChatMessages,
      send: mockSendChatMessage,
      isSending: false,
    }),
  };
});

import * as React from "react";

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------
const mockDoctorUser = {
  id: "64b8e2f01a2b3c4d5e6f7a01",
  email: "doctor@lifeline.org",
  fullName: "Gregory House",
  role: "DOCTOR" as const,
};

const mockPatientUser = {
  id: "64b8e2f01a2b3c4d5e6f7a02",
  email: "patient@lifeline.org",
  fullName: "John Doe",
  role: "PATIENT" as const,
};

const mockAdminUser = {
  id: "64b8e2f01a2b3c4d5e6f7a03",
  email: "admin@lifeline.org",
  fullName: "Platform Admin",
  role: "ADMIN" as const,
};

const mockActiveConsultation: ConsultationRecord = {
  _id: "64b8e2f01a2b3c4d5e6f7a10",
  appointmentId: "64b8e2f01a2b3c4d5e6f7a20",
  doctorId: { _id: mockDoctorUser.id, fullName: "Gregory House", email: mockDoctorUser.email },
  patientId: { _id: mockPatientUser.id, fullName: "John Doe", email: mockPatientUser.email },
  consultationType: "VIDEO",
  status: "IN_CONSULTATION",
  roomId: "consultation-64b8e2f01a2b3c4d5e6f7a10",
  startedAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
  durationSeconds: 120,
};

const mockTokenResponse: ParticipantTokenResponse = {
  consultationId: "64b8e2f01a2b3c4d5e6f7a10",
  roomId: "consultation-64b8e2f01a2b3c4d5e6f7a10",
  token: "mock_signed_livekit_jwt_token_12345",
  expiresInSeconds: 3600,
  status: "IN_CONSULTATION",
  livekitUrl: "https://lifeline-test.livekit.cloud",
};

const mockInitiateResponse: InitiateSessionResponse = {
  consultationId: "64b8e2f01a2b3c4d5e6f7a10",
  appointmentId: "64b8e2f01a2b3c4d5e6f7a20",
  roomId: "consultation-64b8e2f01a2b3c4d5e6f7a10",
  roomUrl: "/consultations/room/consultation-64b8e2f01a2b3c4d5e6f7a10",
  status: "ROOM_OPENED",
  token: "mock_signed_livekit_doctor_jwt_token",
  expiresInSeconds: 3600,
  livekitUrl: "https://lifeline-test.livekit.cloud",
};

const mockCompletedConsultation: ConsultationRecord = {
  _id: "64b8e2f01a2b3c4d5e6f7a10",
  appointmentId: { _id: "64b8e2f01a2b3c4d5e6f7a20", scheduledStart: new Date().toISOString() },
  doctorId: { _id: mockDoctorUser.id, fullName: "Gregory House" },
  patientId: { _id: mockPatientUser.id, fullName: "John Doe" },
  consultationType: "VIDEO",
  status: "COMPLETED",
  roomId: "consultation-64b8e2f01a2b3c4d5e6f7a10",
  startedAt: new Date(Date.now() - 900000).toISOString(),
  endedAt: new Date(Date.now() - 300000).toISOString(),
  durationSeconds: 600,
  diagnosis: "Acute Bronchitis with Cough",
  clinicalNotes: "Patient presents with persistent cough for 4 days. Lungs clear on auscultation. Prescribed bronchodilator.",
  recommendedFollowUpDays: 7,
};

describe("Milestone 13 — Task 13.7: LiveKit Consultation Room UI & Video Grid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
    mockLocalMicEnabled = true;
    mockLocalCameraEnabled = true;
    mockLocalScreenShareEnabled = false;
    mockChatMessages = [];
    mockParticipantsList = [
      { identity: "mock-local-identity", name: "Dr. Gregory House", isLocal: true, isSpeaking: false, isMicrophoneEnabled: true },
    ];
    mockTracksList = [
      {
        source: "camera",
        participant: { identity: "mock-local-identity", isLocal: true },
        publication: { isEnabled: true, isMuted: false, track: {} },
      },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // TEST 1: ID RESOLUTION HELPER
  // =========================================================================
  it("1. resolveConsultationId correctly extracts 24-character IDs from direct IDs and room strings", () => {
    expect(resolveConsultationId("64b8e2f01a2b3c4d5e6f7a10")).toBe("64b8e2f01a2b3c4d5e6f7a10");
    expect(resolveConsultationId("consultation-64b8e2f01a2b3c4d5e6f7a10")).toBe("64b8e2f01a2b3c4d5e6f7a10");
    expect(resolveConsultationId("invalid-id")).toBeNull();
    expect(resolveConsultationId("")).toBeNull();
    expect(resolveConsultationId(undefined)).toBeNull();
  });

  // =========================================================================
  // TEST 2: LOADING EXISTING CONSULTATION & RETRIEVING PARTICIPANT TOKEN
  // =========================================================================
  it("2. loads an existing consultation and retrieves participant token via GET endpoints", async () => {
    useAuthStore.getState().login(mockPatientUser, "test-patient-jwt");

    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === `/consultations/${mockActiveConsultation._id}`) {
        return { success: true, data: mockActiveConsultation };
      }
      if (url === `/consultations/${mockActiveConsultation._id}/token`) {
        return { success: true, data: mockTokenResponse };
      }
      throw new Error(`Unexpected GET url: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-consultation-room")).toBeDefined();
    });

    expect(screen.getByTestId("livekit-room-container")).toBeDefined();
    expect(screen.getByTestId("video-grid")).toBeDefined();
    expect(screen.getByTestId("media-controls")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId("connection-status-badge").textContent).toContain("Connected");
    });
  });

  // =========================================================================
  // TEST 3: DOCTOR ENTRY FROM APPOINTMENT CONTEXT
  // =========================================================================
  it("3. doctor session initiation calls POST /api/v1/consultations/:appointmentId/session", async () => {
    useAuthStore.getState().login(mockDoctorUser, "test-doctor-jwt");

    const postSpy = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      data: mockInitiateResponse,
    });

    vi.spyOn(api, "get").mockResolvedValue({
      success: true,
      data: mockActiveConsultation,
    });

    render(
      <MemoryRouter initialEntries={[`/consultations?appointmentId=64b8e2f01a2b3c4d5e6f7a20`]}>
        <Routes>
          <Route path="/consultations" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/consultations/64b8e2f01a2b3c4d5e6f7a20/session", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-consultation-room")).toBeDefined();
    });
  });

  // =========================================================================
  // TEST 4: INVALID IDENTIFIER HANDLING
  // =========================================================================
  it("4. handles invalid consultation identifier format with clear error alert", async () => {
    useAuthStore.getState().login(mockPatientUser, "test-jwt");

    render(
      <MemoryRouter initialEntries={["/consultations/not-a-valid-mongo-id"]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("consultation-room-error")).toBeDefined();
    });

    expect(screen.getByText(/Invalid consultation or room identifier/i)).toBeDefined();
    expect(screen.getByText(/INVALID_IDENTIFIER/i)).toBeDefined();
  });

  // =========================================================================
  // TEST 5: API ERROR REJECTION (403 AUTH_RESOURCE_ACCESS_DENIED)
  // =========================================================================
  it("5. displays authorization error when non-participant receives 403", async () => {
    useAuthStore.getState().login(mockPatientUser, "test-jwt");

    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError("Access denied: you are not authorized to view this consultation", 403, "AUTH_RESOURCE_ACCESS_DENIED")
    );

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("consultation-room-error")).toBeDefined();
    });

    expect(screen.getByText(/AUTH_RESOURCE_ACCESS_DENIED/i)).toBeDefined();
    expect(screen.getByText(/Access denied: you are not authorized/i)).toBeDefined();
  });

  // =========================================================================
  // TEST 6: LIVEKIT CONNECTION & VIDEO GRID RENDERING
  // =========================================================================
  it("6. renders video grid with local participant tile and camera-off indicator", () => {
    render(<VideoGrid userRole="DOCTOR" doctorName="Gregory House" />);

    expect(screen.getByTestId("video-grid")).toBeDefined();
    expect(screen.getByTestId("local-video-tile")).toBeDefined();
    expect(screen.getByTestId("waiting-participant-placeholder")).toBeDefined();
    expect(screen.getByText(/Waiting for Patient to Join/i)).toBeDefined();
  });

  // =========================================================================
  // TEST 7: REMOTE PARTICIPANT TILE & ROLE BADGE
  // =========================================================================
  it("7. renders remote participant tile when remote user joins room", () => {
    mockParticipantsList = [
      { identity: "mock-local-identity", name: "Dr. Gregory House", isLocal: true, isSpeaking: false, isMicrophoneEnabled: true },
      { identity: "mock-remote-identity", name: "John Doe", isLocal: false, isSpeaking: true, isMicrophoneEnabled: true },
    ];
    mockTracksList = [
      {
        source: "camera",
        participant: { identity: "mock-local-identity", isLocal: true },
        publication: { isEnabled: true, isMuted: false, track: {} },
      },
      {
        source: "camera",
        participant: { identity: "mock-remote-identity", isLocal: false, name: "John Doe", isMicrophoneEnabled: true, isSpeaking: true },
        publication: { isEnabled: true, isMuted: false, track: {} },
      },
    ];

    render(<VideoGrid userRole="DOCTOR" patientName="John Doe" />);

    expect(screen.getByTestId("local-video-tile")).toBeDefined();
    expect(screen.getByTestId("remote-video-tile")).toBeDefined();
    expect(screen.getByText("Speaking")).toBeDefined();
  });

  // =========================================================================
  // TEST 8: SCREEN SHARING ACTIVE VIEW
  // =========================================================================
  it("8. renders dedicated screen-share tile when screen-sharing track is active", () => {
    mockTracksList = [
      {
        source: "camera",
        participant: { identity: "mock-local-identity", isLocal: true },
        publication: { isEnabled: true, isMuted: false, track: {} },
      },
      {
        source: "screen_share",
        participant: { identity: "mock-remote-identity", name: "Attending Radiologist" },
        publication: { isEnabled: true, isMuted: false, isSubscribed: true, track: {} },
      },
    ];

    render(<VideoGrid userRole="DOCTOR" />);

    expect(screen.getByTestId("screen-share-tile")).toBeDefined();
    expect(screen.getByText(/Screen Shared by Attending Radiologist/i)).toBeDefined();
  });

  // =========================================================================
  // TEST 9: MICROPHONE TOGGLE STATE & CALLS
  // =========================================================================
  it("9. microphone toggle toggles state and calls setMicrophoneEnabled", async () => {
    mockLocalMicEnabled = true;

    render(
      <MediaControls
        onEndConsultation={vi.fn()}
        isChatOpen={false}
        onToggleChat={vi.fn()}
      />
    );

    const micBtn = screen.getByTestId("toggle-mic-btn");
    expect(micBtn.getAttribute("aria-label")).toBe("Mute Microphone");

    fireEvent.click(micBtn);

    await waitFor(() => {
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    });
  });

  // =========================================================================
  // TEST 10: CAMERA TOGGLE STATE & CALLS
  // =========================================================================
  it("10. camera toggle toggles state and calls setCameraEnabled", async () => {
    mockLocalCameraEnabled = true;

    render(
      <MediaControls
        onEndConsultation={vi.fn()}
        isChatOpen={false}
        onToggleChat={vi.fn()}
      />
    );

    const camBtn = screen.getByTestId("toggle-camera-btn");
    expect(camBtn.getAttribute("aria-label")).toBe("Turn Off Camera");

    fireEvent.click(camBtn);

    await waitFor(() => {
      expect(mockSetCameraEnabled).toHaveBeenCalledWith(false);
    });
  });

  // =========================================================================
  // TEST 11: SCREEN SHARE TOGGLE
  // =========================================================================
  it("11. screen share toggle handles browser environment gracefully", async () => {
    // Mock navigator.mediaDevices.getDisplayMedia
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue({}),
      },
      configurable: true,
      writable: true,
    });

    render(
      <MediaControls
        onEndConsultation={vi.fn()}
        isChatOpen={false}
        onToggleChat={vi.fn()}
      />
    );

    const screenBtn = screen.getByTestId("toggle-screen-share-btn");
    expect(screenBtn.getAttribute("aria-label")).toBe("Share Screen");

    fireEvent.click(screenBtn);

    await waitFor(() => {
      expect(mockSetScreenShareEnabled).toHaveBeenCalledWith(true);
    });
  });

  // =========================================================================
  // TEST 12: MEDIA PERMISSION ERROR ALERT
  // =========================================================================
  it("12. displays error message when media track toggle rejects with hardware error", async () => {
    mockSetCameraEnabled.mockRejectedValueOnce(new Error("Permission denied by system"));

    render(
      <MediaControls
        onEndConsultation={vi.fn()}
        isChatOpen={false}
        onToggleChat={vi.fn()}
      />
    );

    const camBtn = screen.getByTestId("toggle-camera-btn");
    fireEvent.click(camBtn);

    await waitFor(() => {
      expect(screen.getByTestId("media-controls-error")).toBeDefined();
    });
    expect(screen.getByText(/Permission denied by system/i)).toBeDefined();
  });

  // =========================================================================
  // TEST 13: END CONSULTATION CONFIRMATION DIALOG
  // =========================================================================
  it("13. prompts confirmation dialog before executing onEndConsultation", async () => {
    const endFn = vi.fn();

    render(
      <MediaControls
        onEndConsultation={endFn}
        isChatOpen={false}
        onToggleChat={vi.fn()}
      />
    );

    const endBtn = screen.getByTestId("end-consultation-btn");
    fireEvent.click(endBtn);

    expect(screen.getByTestId("confirm-end-dialog")).toBeDefined();
    expect(endFn).not.toHaveBeenCalled();

    const confirmBtn = screen.getByTestId("confirm-end-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(endFn).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // TEST 14: IN-ROOM DATACHANNEL CHAT MESSAGING
  // =========================================================================
  it("14. sends chat message over LiveKit DataChannel and prevents blank messages", async () => {
    mockChatMessages = [
      {
        id: "msg-1",
        message: "Hello patient, how are you feeling today?",
        timestamp: Date.now() - 60000,
        from: { identity: "mock-local-identity", name: "Dr. Gregory House" },
      },
    ];

    render(
      <ConsultationChatPanel
        isOpen={true}
        onClose={vi.fn()}
        currentUserId="mock-local-identity"
        currentUserName="Dr. Gregory House"
        userRole="DOCTOR"
      />
    );

    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByText(/Hello patient, how are you feeling today/i)).toBeDefined();

    const input = screen.getByTestId("chat-input");
    const sendBtn = screen.getByTestId("send-chat-btn");

    // Empty message: button disabled
    expect(sendBtn.hasAttribute("disabled")).toBe(true);

    // Type message and submit
    fireEvent.change(input, { target: { value: "I am feeling better, doctor." } });
    expect(sendBtn.hasAttribute("disabled")).toBe(false);

    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalledWith("I am feeling better, doctor.");
    });
  });

  // =========================================================================
  // TEST 15: SESSION TIMER RENDERING
  // =========================================================================
  it("15. session timer renders formatted time from startedAt timestamp", async () => {
    useAuthStore.getState().login(mockPatientUser, "test-jwt");

    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === `/consultations/${mockActiveConsultation._id}`) {
        return { success: true, data: mockActiveConsultation };
      }
      if (url === `/consultations/${mockActiveConsultation._id}/token`) {
        return { success: true, data: mockTokenResponse };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("consultation-timer")).toBeDefined();
    });

    // Should display MM:SS format
    const timerText = screen.getByTestId("consultation-timer").textContent;
    expect(timerText).toMatch(/\d{2}:\d{2}/);
  });

  // =========================================================================
  // TEST 16: DOCTOR CLINICAL WRAP-UP MODAL & VALIDATION
  // =========================================================================
  it("16. doctor wrap-up validates minimum diagnosis and clinical notes constraints", async () => {
    useAuthStore.getState().login(mockDoctorUser, "test-doctor-jwt");

    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url.includes("/token")) {
        return { success: true, data: mockTokenResponse };
      }
      return { success: true, data: mockActiveConsultation };
    });
    vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === `/consultations/${mockActiveConsultation._id}/end`) {
        return { success: true, data: { ...mockActiveConsultation, status: "ENDED" } };
      }
      if (url === `/consultations/${mockActiveConsultation._id}/notes`) {
        return { success: true, data: mockCompletedConsultation };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("end-consultation-btn")).toBeDefined();
    });

    // End call
    fireEvent.click(screen.getByTestId("end-consultation-btn"));
    fireEvent.click(screen.getByTestId("confirm-end-btn"));

    // Wrap-up dialog opens
    await waitFor(() => {
      expect(screen.getByTestId("doctor-wrapup-dialog")).toBeDefined();
    });

    const submitBtn = screen.getByTestId("submit-wrapup-btn");
    const diagInput = screen.getByTestId("wrapup-diagnosis-input");
    const notesInput = screen.getByTestId("wrapup-notes-input");

    // Attempt submitting with < 3 characters diagnosis
    fireEvent.change(diagInput, { target: { value: "AB" } });
    fireEvent.change(notesInput, { target: { value: "Notes" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Diagnosis must be at least 3 characters long/i)).toBeDefined();
    });
  });

  // =========================================================================
  // TEST 17: SUCCESSFUL NOTES SUBMISSION TRANSITIONS TO SUMMARY VIEW
  // =========================================================================
  it("17. doctor clinical notes submission marks consultation COMPLETED and renders summary view", async () => {
    useAuthStore.getState().login(mockDoctorUser, "test-doctor-jwt");

    let isNotesSubmitted = false;
    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url.includes("/token")) {
        return { success: true, data: mockTokenResponse };
      }
      if (url === `/consultations/${mockActiveConsultation._id}`) {
        return { success: true, data: isNotesSubmitted ? mockCompletedConsultation : mockActiveConsultation };
      }
      return { success: true, data: mockActiveConsultation };
    });

    const postSpy = vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === `/consultations/${mockActiveConsultation._id}/end`) {
        return { success: true, data: { ...mockActiveConsultation, status: "ENDED" } };
      }
      if (url === `/consultations/${mockActiveConsultation._id}/notes`) {
        isNotesSubmitted = true;
        return { success: true, data: mockCompletedConsultation };
      }
      throw new Error(`Unexpected POST url: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("end-consultation-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("end-consultation-btn"));
    fireEvent.click(screen.getByTestId("confirm-end-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-wrapup-dialog")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("wrapup-diagnosis-input"), {
      target: { value: "Acute Bronchitis with Cough" },
    });
    fireEvent.change(screen.getByTestId("wrapup-notes-input"), {
      target: { value: "Patient presents with persistent cough for 4 days. Prescribed bronchodilator." },
    });
    fireEvent.change(screen.getByTestId("wrapup-followup-input"), {
      target: { value: "7" },
    });

    fireEvent.click(screen.getByTestId("submit-wrapup-btn"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(`/consultations/${mockActiveConsultation._id}/notes`, {
        diagnosis: "Acute Bronchitis with Cough",
        clinicalNotes: "Patient presents with persistent cough for 4 days. Prescribed bronchodilator.",
        recommendedFollowUpDays: 7,
      });
    });

    // Summary view should be rendered
    await waitFor(() => {
      expect(screen.getByTestId("consultation-summary-view")).toBeDefined();
    });

    expect(screen.getByTestId("summary-diagnosis").textContent).toContain("Acute Bronchitis with Cough");
    expect(screen.getByTestId("summary-issue-rx-btn")).toBeDefined();
  });

  // =========================================================================
  // TEST 18: DIRECT ENTRY TO COMPLETED CONSULTATION RENDERS SUMMARY
  // =========================================================================
  it("18. directly navigating to a COMPLETED consultation immediately renders summary view", async () => {
    useAuthStore.getState().login(mockPatientUser, "test-patient-jwt");

    vi.spyOn(api, "get").mockResolvedValue({
      success: true,
      data: mockCompletedConsultation,
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockCompletedConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("consultation-summary-view")).toBeDefined();
    });

    expect(screen.getByText("Consultation Session Concluded")).toBeDefined();
    expect(screen.getByTestId("summary-diagnosis").textContent).toContain("Acute Bronchitis with Cough");
    expect(screen.getByText(/Return to Dashboard/i)).toBeDefined();

    // Verify admin role renders admin-specific operation button
    useAuthStore.getState().login(mockAdminUser, "test-admin-jwt");
    render(
      <MemoryRouter initialEntries={[`/consultations/${mockCompletedConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/:id" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Return to Admin Operations")).toBeDefined();
    });
  });

  // =========================================================================
  // TEST 19: ROOM URL ROUTE ALIAS (/consultations/room/:roomId)
  // =========================================================================
  it("19. resolves room URL alias /consultations/room/:roomId and fetches consultation data", async () => {
    useAuthStore.getState().login(mockDoctorUser, "test-doctor-jwt");

    const getSpy = vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === `/consultations/${mockActiveConsultation._id}`) {
        return { success: true, data: mockActiveConsultation };
      }
      if (url === `/consultations/${mockActiveConsultation._id}/token`) {
        return { success: true, data: mockTokenResponse };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={[`/consultations/room/consultation-${mockActiveConsultation._id}`]}>
        <Routes>
          <Route path="/consultations/room/:roomId" element={<ConsultationRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(`/consultations/${mockActiveConsultation._id}`);
    });
  });

  // =========================================================================
  // TEST 20: ROUTE PROTECTION IN ROOT APP ROUTER
  // =========================================================================
  it("20. unauthenticated user is redirected to /login when attempting to access consultation room", async () => {
    useAuthStore.getState().logout();

    render(
      <MemoryRouter initialEntries={[`/consultations/${mockActiveConsultation._id}`]}>
        <AppRoutes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Sign In to LifeLine")).toBeDefined();
    });
  });
});
