export type CodexFailureReason =
  | "rate_limit"
  | "auth_permanent"
  | "billing"
  | "timeout"
  | "unknown";

export type CodexFailureAction = "cooldown" | "disable" | "retry";

export type CodexFailureClassification = {
  reason: CodexFailureReason;
  action: CodexFailureAction;
  normalizedCode: string;
};

export function classifyCodexFailure(raw: string): CodexFailureClassification {
  const text = raw.toLowerCase();

  if (text.includes("deactivated_workspace")) {
    return {
      reason: "auth_permanent",
      action: "disable",
      normalizedCode: "deactivated_workspace"
    };
  }

  if (
    text.includes("invalid_grant") ||
    text.includes("auth revoked") ||
    text.includes("workspace disabled") ||
    text.includes("authentication failed")
  ) {
    return {
      reason: "auth_permanent",
      action: "disable",
      normalizedCode: "auth_revoked"
    };
  }

  if (
    text.includes("usage limit") ||
    text.includes("429") ||
    text.includes("retry-after") ||
    text.includes("insufficient_quota")
  ) {
    return {
      reason: "rate_limit",
      action: "cooldown",
      normalizedCode: "rate_limit"
    };
  }

  if (
    text.includes("insufficient credits") ||
    text.includes("billing") ||
    text.includes("payment required")
  ) {
    return {
      reason: "billing",
      action: "disable",
      normalizedCode: "billing"
    };
  }

  if (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  ) {
    return {
      reason: "timeout",
      action: "retry",
      normalizedCode: "timeout"
    };
  }

  return {
    reason: "unknown",
    action: "retry",
    normalizedCode: "unknown"
  };
}
