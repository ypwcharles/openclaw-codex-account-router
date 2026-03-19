import { z } from "zod";

export const RouterAccountSchema = z.object({
  alias: z.string().min(1),
  profileId: z.string().min(1),
  provider: z.literal("openai-codex"),
  priority: z.number().int().nonnegative(),
  status: z.enum(["healthy", "cooldown", "disabled", "unknown"]),
  enabled: z.boolean().default(true),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastErrorCode: z.string().min(1).optional(),
  cooldownUntil: z.string().datetime().optional(),
  defaultProfileFingerprint: z.string().min(1).optional()
});

export const RouterStateSchema = z.object({
  version: z.literal(1),
  accounts: z.array(RouterAccountSchema),
  lastProviderFallbackReason: z.string().min(1).optional()
});
