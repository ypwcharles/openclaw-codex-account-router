import { readFile } from "node:fs/promises";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_CHATGPT_ACCOUNT_ID_CLAIM = "https://api.openai.com/auth.chatgpt_account_id";

type OpenClawAuthProfile = {
  provider?: string;
  access?: string;
  accountId?: string;
  account_id?: string;
  [key: string]: unknown;
};

type OpenClawAuthStore = {
  profiles?: Record<string, OpenClawAuthProfile>;
};

type UsageWindowSnapshot = {
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetAt?: number;
};

export type CodexQuotaSnapshot = {
  source: "usage_api";
  fetchedAt: number;
  planType?: string;
  limitReached?: boolean;
  primary?: UsageWindowSnapshot;
  secondary?: UsageWindowSnapshot;
  cooldownUntil?: number;
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<FetchLikeResponse>;

export async function fetchCodexUsageSnapshot(params: {
  authStorePath: string;
  profileId: string;
  now?: Date;
  fetchImpl?: FetchLike;
}): Promise<CodexQuotaSnapshot | undefined> {
  const now = params.now ?? new Date();
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error("global fetch is not available");
  }

  const profile = await loadCodexAuthProfile(params.authStorePath, params.profileId);
  if (!profile?.access || profile.provider !== OPENAI_CODEX_PROVIDER) {
    return undefined;
  }

  const accountId = resolveChatGptAccountId(profile);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${profile.access}`,
    Accept: "application/json"
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const response = await fetchImpl(USAGE_URL, {
    method: "GET",
    headers
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`codex usage api returned ${response.status}: ${truncate(body, 200)}`);
  }

  return parseCodexUsageResponse(body, { now });
}

export function parseCodexUsageResponse(
  body: string,
  params: { now?: Date } = {}
): CodexQuotaSnapshot {
  const now = params.now ?? new Date();
  const parsed = JSON.parse(body) as {
    plan_type?: unknown;
    rate_limit?: {
      limit_reached?: unknown;
      primary_window?: UsageWindowResponse;
      secondary_window?: UsageWindowResponse;
    };
  };

  const primary = parseUsageWindow(parsed.rate_limit?.primary_window, now);
  const secondary = parseUsageWindow(parsed.rate_limit?.secondary_window, now);
  const limitReached =
    typeof parsed.rate_limit?.limit_reached === "boolean"
      ? parsed.rate_limit.limit_reached
      : undefined;

  return {
    source: "usage_api",
    fetchedAt: now.getTime(),
    planType: typeof parsed.plan_type === "string" ? parsed.plan_type : undefined,
    limitReached,
    primary,
    secondary,
    cooldownUntil: resolveCooldownUntil({ primary, secondary, limitReached })
  };
}

type UsageWindowResponse = {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;
  reset_after_seconds?: unknown;
};

function parseUsageWindow(
  window: UsageWindowResponse | undefined,
  now: Date
): UsageWindowSnapshot | undefined {
  if (!window || typeof window !== "object") {
    return undefined;
  }

  const usedPercent = normalizePercent(window.used_percent);
  const windowMinutes = normalizeWindowMinutes(window.limit_window_seconds);
  const resetAt = normalizeResetAt({
    resetAt: window.reset_at,
    resetAfterSeconds: window.reset_after_seconds,
    nowMs: now.getTime()
  });

  if (usedPercent === undefined && windowMinutes === undefined && resetAt === undefined) {
    return undefined;
  }

  return {
    usedPercent,
    remainingPercent:
      usedPercent === undefined ? undefined : Math.max(0, Math.min(100, 100 - usedPercent)),
    windowMinutes,
    resetAt
  };
}

function normalizePercent(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampPercent(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampPercent(parsed);
    }
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWindowMinutes(value: unknown): number | undefined {
  const seconds = normalizeNumber(value);
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  return Math.ceil(seconds / 60);
}

function normalizeResetAt(params: {
  resetAt: unknown;
  resetAfterSeconds: unknown;
  nowMs: number;
}): number | undefined {
  const resetAt = normalizeNumber(params.resetAt);
  if (resetAt !== undefined && resetAt > 0) {
    return resetAt < 1_000_000_000_000 ? Math.round(resetAt * 1000) : Math.round(resetAt);
  }

  const resetAfterSeconds = normalizeNumber(params.resetAfterSeconds);
  if (resetAfterSeconds !== undefined && resetAfterSeconds >= 0) {
    return params.nowMs + Math.round(resetAfterSeconds * 1000);
  }

  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function resolveCooldownUntil(params: {
  primary?: UsageWindowSnapshot;
  secondary?: UsageWindowSnapshot;
  limitReached?: boolean;
}): number | undefined {
  const exhausted = [params.primary, params.secondary]
    .filter((window): window is UsageWindowSnapshot => Boolean(window))
    .filter((window) => window.remainingPercent !== undefined && window.remainingPercent <= 0)
    .map((window) => window.resetAt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (exhausted.length > 0) {
    return Math.min(...exhausted);
  }

  if (!params.limitReached) {
    return undefined;
  }

  const available = [params.primary?.resetAt, params.secondary?.resetAt].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (available.length === 0) {
    return undefined;
  }
  return Math.min(...available);
}

async function loadCodexAuthProfile(
  authStorePath: string,
  profileId: string
): Promise<OpenClawAuthProfile | undefined> {
  const raw = await readFile(authStorePath, "utf8");
  const parsed = JSON.parse(raw) as OpenClawAuthStore;
  return parsed.profiles?.[profileId];
}

function resolveChatGptAccountId(profile: OpenClawAuthProfile): string | undefined {
  const direct = normalizeString(profile.accountId) ?? normalizeString(profile.account_id);
  if (direct) {
    return direct;
  }
  return extractChatGptAccountIdFromAccessToken(profile.access);
}

function extractChatGptAccountIdFromAccessToken(token: string | undefined): string | undefined {
  if (typeof token !== "string" || !token.trim()) {
    return undefined;
  }

  try {
    const [, payload] = token.split(".", 3);
    if (!payload) {
      return undefined;
    }
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as {
      [OPENAI_CHATGPT_ACCOUNT_ID_CLAIM]?: unknown;
      [OPENAI_AUTH_CLAIM_PATH]?: {
        chatgpt_account_id?: unknown;
        account_id?: unknown;
      };
      account_id?: unknown;
    };

    return (
      normalizeString(parsed[OPENAI_CHATGPT_ACCOUNT_ID_CLAIM]) ??
      normalizeString(parsed[OPENAI_AUTH_CLAIM_PATH]?.chatgpt_account_id) ??
      normalizeString(parsed[OPENAI_AUTH_CLAIM_PATH]?.account_id) ??
      normalizeString(parsed.account_id)
    );
  } catch {
    return undefined;
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}
