import { Resend } from "resend";
import { env } from "../../config/env.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Escapes HTML characters in untrusted text content to prevent XSS payloads in email templates.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates a clean, branded LifeLine notification email layout with safely escaped content.
 */
export function generateNotificationEmailHtml(options: {
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}): string {
  const safeTitle = escapeHtml(options.title);
  const safeMessage = escapeHtml(options.message);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; }
    .header { border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 20px; font-weight: bold; color: #1e40af; }
    .title { font-size: 18px; font-weight: 600; margin: 0 0 12px 0; color: #0f172a; }
    .content { font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px; }
    .footer { font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">LifeLine Healthcare</div>
    </div>
    <h2 class="title">${safeTitle}</h2>
    <div class="content">${safeMessage}</div>
    <div class="footer">
      <p>This is an automated notification from LifeLine Healthcare Platform.</p>
      <p>Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

export class ResendEmailClient {
  private client: Resend | null = null;
  private isConfigured = false;
  private defaultFrom: string;

  constructor() {
    this.defaultFrom = env.EMAIL_FROM || "notifications@lifeline-healthcare.local";
    if (env.RESEND_API_KEY && env.RESEND_API_KEY.trim()) {
      this.client = new Resend(env.RESEND_API_KEY.trim());
      this.isConfigured = true;
    }
  }

  /**
   * Indicates whether Resend has valid credentials configured.
   */
  public isReady(): boolean {
    return this.isConfigured && this.client !== null;
  }

  /**
   * Asynchronously dispatches an email via Resend.
   * Fail-safe: Returns structured success/failure without throwing or breaking business flows.
   */
  public async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.isReady() || !this.client) {
      return {
        success: false,
        skipped: true,
        reason: "RESEND_NOT_CONFIGURED",
      };
    }

    try {
      const from = options.from || this.defaultFrom;
      const emailPayload = options.html
        ? {
            from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            ...(options.text ? { text: options.text } : {}),
          }
        : {
            from,
            to: options.to,
            subject: options.subject,
            text: options.text || options.subject,
          };
      const response = await this.client.emails.send(emailPayload);

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
        };
      }

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error during email dispatch";
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const resendClient = new ResendEmailClient();
