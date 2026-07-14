import { z } from "zod";

/**
 * Client-side mirror of the protovalidate rules in newsletter.proto
 * (email must be valid, name 2..50 chars). The server remains the source
 * of truth — this schema only exists for instant field-level feedback.
 */
export const subscribeSchema = z.object({
  email: z.email("Enter a valid email address"),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
});
