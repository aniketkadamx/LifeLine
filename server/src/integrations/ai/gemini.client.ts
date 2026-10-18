import { env } from "../../config/env.js";
import { AppError } from "../../utils/api-error.js";

/**
 * Generic request parameters for swappable AI completion providers.
 */
export interface AICompletionRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Normalized response structure returned by AI completion providers.
 */
export interface AICompletionResponse {
  text: string;
  model: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Swappable AI provider contract.
 * Decouples domain services and controllers from vendor-specific LLM implementations.
 */
export interface IAIProviderClient {
  generateCompletion(request: AICompletionRequest): Promise<AICompletionResponse>;
}

/**
 * Gemini-specific credentials resolution interface.
 */
export interface GeminiConfig {
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

let customConfig: Partial<GeminiConfig> | null = null;

/**
 * Sets custom Gemini configuration overrides (primarily for automated tests).
 * Pass null to restore environment-based credential resolution.
 */
export function setGeminiConfig(config: Partial<GeminiConfig> | null): void {
  customConfig = config;
}

/**
 * Resolves active Gemini API configuration from configuration schema or test overrides.
 */
export function getGeminiConfig(): GeminiConfig {
  const apiKey =
    customConfig?.apiKey !== undefined
      ? customConfig.apiKey
      : process.env.GEMINI_API_KEY ||
        env.GEMINI_API_KEY ||
        process.env.AI_API_KEY ||
        env.AI_API_KEY;

  const model =
    customConfig?.model !== undefined
      ? customConfig.model
      : process.env.GEMINI_MODEL ||
        env.GEMINI_MODEL ||
        process.env.AI_MODEL ||
        env.AI_MODEL ||
        "gemini-1.5-flash";

  const timeoutMs =
    customConfig?.timeoutMs !== undefined
      ? customConfig.timeoutMs
      : env.GEMINI_TIMEOUT_MS || 10000;

  return { apiKey, model, timeoutMs };
}

/**
 * Concrete provider adapter for Google Gemini Generative Language REST API.
 * Uses native fetch and AbortSignal.timeout to prevent dependency bloat.
 */
export class GeminiClient implements IAIProviderClient {
  public async generateCompletion(
    request: AICompletionRequest
  ): Promise<AICompletionResponse> {
    const config = getGeminiConfig();

    if (!config.apiKey || config.apiKey === "placeholder_gemini_api_key") {
      throw new AppError(
        503,
        "AI_SERVICE_UNAVAILABLE",
        "AI healthcare assistant service is temporarily unavailable (missing API credentials)"
      );
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.model
    )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: request.userMessage }],
        },
      ],
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 800,
      },
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new AppError(
          504,
          "AI_PROVIDER_TIMEOUT",
          "AI provider request timed out"
        );
      }
      throw new AppError(
        503,
        "AI_SERVICE_UNAVAILABLE",
        "Failed to communicate with AI provider"
      );
    }

    if (!response.ok) {
      // Never log or expose raw provider response body or API key
      const status = response.status;
      if (status === 429) {
        throw new AppError(
          429,
          "AI_PROVIDER_RATE_LIMIT",
          "Upstream AI provider rate limit reached"
        );
      }
      throw new AppError(
        503,
        "AI_SERVICE_UNAVAILABLE",
        `AI provider returned an unexpected status code (${status})`
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new AppError(
        502,
        "AI_INVALID_RESPONSE",
        "AI provider returned a malformed response body"
      );
    }

    const candidateText =
      json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText || typeof candidateText !== "string") {
      throw new AppError(
        502,
        "AI_EMPTY_RESPONSE",
        "AI provider returned an empty or invalid candidate"
      );
    }

    return {
      text: candidateText.trim(),
      model: config.model,
      tokenUsage: {
        promptTokens: json?.usageMetadata?.promptTokenCount,
        completionTokens: json?.usageMetadata?.candidatesTokenCount,
        totalTokens: json?.usageMetadata?.totalTokenCount,
      },
    };
  }
}

let activeProviderClient: IAIProviderClient = new GeminiClient();

/**
 * Overrides or resets the active AI provider client (for testing or provider swapping).
 * Pass null to restore default GeminiClient instance.
 */
export function setAIProviderClient(client: IAIProviderClient | null): void {
  activeProviderClient = client ?? new GeminiClient();
}

/**
 * Returns the currently active AI provider client implementation.
 */
export function getAIProviderClient(): IAIProviderClient {
  return activeProviderClient;
}
