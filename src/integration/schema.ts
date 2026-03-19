import { z } from "zod";

export const IntegrationStateSchema = z.object({
  version: z.literal(1),
  platform: z.enum(["darwin", "linux"]),
  installRoot: z.string().min(1),
  shimPath: z.string().min(1),
  realOpenClawPath: z.string().min(1),
  servicePath: z.string().min(1),
  lastSetupAt: z.string().datetime(),
  routerStatePath: z.string().min(1).optional(),
  authStorePath: z.string().min(1).optional()
});
