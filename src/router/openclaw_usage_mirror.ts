export type MirroredFailureReason =
  | "auth_permanent"
  | "billing"
  | "rate_limit"
  | "timeout"
  | "unknown";

export type OpenClawUsageStats = {
  lastUsed?: number;
  cooldownUntil?: number;
  disabledUntil?: number;
  disabledReason?: MirroredFailureReason;
  errorCount?: number;
  failureCounts?: Partial<Record<MirroredFailureReason, number>>;
  lastFailureAt?: number;
};

export function mirrorFailureStats(params: {
  existing: OpenClawUsageStats | undefined;
  reason: MirroredFailureReason;
  nowMs: number;
}): OpenClawUsageStats {
  const existing = params.existing ?? {};
  const existingCount = existing.errorCount ?? 0;
  const nextErrorCount = existingCount + 1;
  const failureCounts = { ...(existing.failureCounts ?? {}) };
  failureCounts[params.reason] = (failureCounts[params.reason] ?? 0) + 1;

  const next: OpenClawUsageStats = {
    ...existing,
    errorCount: nextErrorCount,
    failureCounts,
    lastFailureAt: params.nowMs
  };

  if (params.reason === "auth_permanent" || params.reason === "billing") {
    const baseMs = 5 * 60 * 60 * 1000;
    const capMs = 24 * 60 * 60 * 1000;
    const reasonCount = failureCounts[params.reason] ?? 1;
    const disableMs = Math.min(capMs, baseMs * 2 ** Math.min(reasonCount - 1, 10));
    next.disabledUntil = params.nowMs + disableMs;
    next.disabledReason = params.reason;
    next.cooldownUntil = undefined;
    return next;
  }

  const cooldownMs = Math.min(60 * 60 * 1000, 60 * 1000 * 5 ** Math.min(nextErrorCount - 1, 3));
  next.cooldownUntil = params.nowMs + cooldownMs;
  next.disabledUntil = undefined;
  next.disabledReason = undefined;
  return next;
}
