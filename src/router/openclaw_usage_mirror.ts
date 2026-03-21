import type { CodexQuotaSnapshot } from "./codex_usage_api.js";

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
  quotaSource?: "usage_api";
  quotaFetchedAt?: number;
  planType?: string;
  limitReached?: boolean;
  primaryUsedPercent?: number;
  primaryRemainingPercent?: number;
  primaryWindowMinutes?: number;
  primaryResetAt?: number;
  secondaryUsedPercent?: number;
  secondaryRemainingPercent?: number;
  secondaryWindowMinutes?: number;
  secondaryResetAt?: number;
};

export function mirrorFailureStats(params: {
  existing: OpenClawUsageStats | undefined;
  reason: MirroredFailureReason;
  nowMs: number;
  cooldownUntilOverrideMs?: number;
  quotaSnapshot?: CodexQuotaSnapshot;
}): OpenClawUsageStats {
  const existing = params.existing ?? {};
  const existingCount = existing.errorCount ?? 0;
  const nextErrorCount = existingCount + 1;
  const failureCounts = { ...(existing.failureCounts ?? {}) };
  failureCounts[params.reason] = (failureCounts[params.reason] ?? 0) + 1;

  const next: OpenClawUsageStats = applyQuotaSnapshot(
    {
      ...existing,
      errorCount: nextErrorCount,
      failureCounts,
      lastFailureAt: params.nowMs
    },
    params.quotaSnapshot
  );

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

  const cooldownMs =
    typeof params.cooldownUntilOverrideMs === "number" && Number.isFinite(params.cooldownUntilOverrideMs)
      ? params.cooldownUntilOverrideMs
      : params.nowMs + Math.min(60 * 60 * 1000, 60 * 1000 * 5 ** Math.min(nextErrorCount - 1, 3));
  next.cooldownUntil = cooldownMs;
  next.disabledUntil = undefined;
  next.disabledReason = undefined;
  return next;
}

function applyQuotaSnapshot(
  target: OpenClawUsageStats,
  snapshot: CodexQuotaSnapshot | undefined
): OpenClawUsageStats {
  if (!snapshot) {
    return target;
  }

  return {
    ...target,
    quotaSource: snapshot.source,
    quotaFetchedAt: snapshot.fetchedAt,
    planType: snapshot.planType,
    limitReached: snapshot.limitReached,
    primaryUsedPercent: snapshot.primary?.usedPercent,
    primaryRemainingPercent: snapshot.primary?.remainingPercent,
    primaryWindowMinutes: snapshot.primary?.windowMinutes,
    primaryResetAt: snapshot.primary?.resetAt,
    secondaryUsedPercent: snapshot.secondary?.usedPercent,
    secondaryRemainingPercent: snapshot.secondary?.remainingPercent,
    secondaryWindowMinutes: snapshot.secondary?.windowMinutes,
    secondaryResetAt: snapshot.secondary?.resetAt
  };
}
