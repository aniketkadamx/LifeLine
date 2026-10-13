import { AccessToken, TokenVerifier, type VideoGrant } from "livekit-server-sdk";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/api-error.js";

/**
 * Options for minting a LiveKit participant access token.
 */
export interface GenerateLiveKitTokenOptions {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  ttlSeconds?: number;
}

/**
 * LiveKit configuration credentials interface.
 */
export interface LiveKitCredentials {
  apiKey: string;
  apiSecret: string;
  livekitUrl: string;
}

let customCredentials: Partial<LiveKitCredentials> | null = null;

/**
 * Overrides or resets LiveKit credentials (primarily used for automated tests and dependency injection).
 * Pass null to restore environment-based credential resolution.
 */
export function setLiveKitCredentials(
  credentials: Partial<LiveKitCredentials> | null
): void {
  customCredentials = credentials;
}

/**
 * Resolves active LiveKit credentials from configuration or test overrides.
 * Fails safely with a 503 error if any required configuration is missing,
 * strictly preventing token issuance with missing or incomplete credentials.
 */
export function getLiveKitCredentials(): LiveKitCredentials {
  const apiKey =
    customCredentials?.apiKey !== undefined
      ? customCredentials.apiKey
      : process.env.LIVEKIT_API_KEY || env.LIVEKIT_API_KEY;
  const apiSecret =
    customCredentials?.apiSecret !== undefined
      ? customCredentials.apiSecret
      : process.env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET;
  const livekitUrl =
    customCredentials?.livekitUrl !== undefined
      ? customCredentials.livekitUrl
      : process.env.LIVEKIT_URL || env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new AppError(
      503,
      "CONSULTATION_VIDEO_PROVIDER_ERROR",
      "LiveKit video provider configuration is incomplete: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL must be configured"
    );
  }

  return { apiKey, apiSecret, livekitUrl };
}

/**
 * Returns the public LiveKit Cloud URL for client WebRTC connection initialization.
 * Never exposes the API key or secret.
 */
export function getLiveKitUrl(): string {
  const { livekitUrl } = getLiveKitCredentials();
  return livekitUrl;
}

/**
 * Generates a cryptographically signed LiveKit AccessToken JWT using the official livekit-server-sdk.
 *
 * Security and Grant Guarantees:
 * - Scoped strictly to the specified consultation room (roomJoin: true, room: roomName).
 * - Least privilege: explicitly disallows roomAdmin, roomCreate, roomList, and roomRecord.
 * - Enforces exact 60-minute token lifetime (3600 seconds) by default.
 * - Cryptographically signed by the official SDK; never prints secrets or tokens in logs.
 *
 * @param options - Room and participant parameters
 * @returns Server-signed LiveKit JWT string
 */
export async function generateLiveKitToken(
  options: GenerateLiveKitTokenOptions
): Promise<string> {
  const { roomName, participantIdentity, participantName } = options;

  if (!roomName || typeof roomName !== "string" || !roomName.trim()) {
    throw AppError.badRequest("Room name is required for video token generation", "BAD_REQUEST");
  }

  if (!participantIdentity || typeof participantIdentity !== "string" || !participantIdentity.trim()) {
    throw AppError.badRequest("Participant identity is required for video token generation", "BAD_REQUEST");
  }

  const { apiKey, apiSecret } = getLiveKitCredentials();

  // Enforce 60-minute token lifetime (3600 seconds)
  const ttl = options.ttlSeconds || 3600;

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity.trim(),
      name: participantName?.trim(),
      ttl,
    });

    const grant: VideoGrant = {
      roomJoin: true,
      room: roomName.trim(),
      canPublish: options.canPublish ?? true,
      canSubscribe: options.canSubscribe ?? true,
      canPublishData: options.canPublishData ?? true,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
      ingressAdmin: false,
    };

    at.addGrant(grant);

    const token = await at.toJwt();
    return token;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Token generation failure";
    throw new AppError(
      503,
      "CONSULTATION_VIDEO_PROVIDER_ERROR",
      `Failed to generate video session token: ${message}`
    );
  }
}

/**
 * Verifies and decodes a LiveKit JWT token using TokenVerifier.
 * Primarily used in automated tests and security assertions.
 *
 * @param token - Signed LiveKit JWT
 * @param apiKeyOverride - Optional key override
 * @param apiSecretOverride - Optional secret override
 * @returns Decoded JWT claims
 */
export async function verifyLiveKitToken(
  token: string,
  apiKeyOverride?: string,
  apiSecretOverride?: string
): Promise<any> {
  const { apiKey, apiSecret } = getLiveKitCredentials();
  const verifier = new TokenVerifier(
    apiKeyOverride || apiKey,
    apiSecretOverride || apiSecret
  );
  return await verifier.verify(token);
}
