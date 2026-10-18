import { z } from "zod";

/**
 * Validated query parameters for date-bounded operational analytics.
 * Supports optional ISO 8601 boundaries ('from' and 'to').
 * Enforces strict temporal ordering: 'from' <= 'to'.
 * Source: docs/api/API_CONTRACT.md Group 19 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.3.
 */
export const analyticsDateFilterSchema = z
  .object({
    from: z
      .string()
      .trim()
      .refine(
        (val) => {
          const parsed = Date.parse(val);
          return !isNaN(parsed) && !isNaN(new Date(val).getTime());
        },
        {
          message: "'from' must be a valid ISO 8601 date string",
        }
      )
      .optional(),
    to: z
      .string()
      .trim()
      .refine(
        (val) => {
          const parsed = Date.parse(val);
          return !isNaN(parsed) && !isNaN(new Date(val).getTime());
        },
        {
          message: "'to' must be a valid ISO 8601 date string",
        }
      )
      .optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from).getTime() <= new Date(data.to).getTime();
      }
      return true;
    },
    {
      message: "'from' date must be earlier than or equal to 'to' date",
      path: ["from"],
    }
  );

export type AnalyticsDateFilterQuery = z.infer<typeof analyticsDateFilterSchema>;
