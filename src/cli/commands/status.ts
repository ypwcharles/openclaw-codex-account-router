import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { loadRouterState } from "../../account_store/store.js";
import type { AccountStatus, RouterAccount } from "../../account_store/types.js";
import { loadIntegrationState } from "../../integration/store.js";
import {
  resolveAuthStorePath,
  resolveOptionalIntegrationStatePath,
  resolveRouterStatePath
} from "../../shared/paths.js";

export type RouterStatusPayload = {
  currentOrder: string[];
  activeAccounts: string[];
  nextCandidate?: string;
  cooldowns: Array<{ alias: string; until?: string }>;
  lastErrorCodes: Array<{ alias: string; code?: string }>;
  authLastGoodProfileId?: string;
  accounts: Array<{
    alias: string;
    profileId: string;
    enabled: boolean;
    configuredStatus: AccountStatus;
    effectiveStatus: AccountStatus;
    cooldownUntil?: string;
    retryUntil?: string;
    retryReason?: string;
    disabledUntil?: string;
    lastErrorCode?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastUsedAt?: string;
    selected: boolean;
    quota?: {
      source?: string;
      fetchedAt?: string;
      planType?: string;
      limitReached?: boolean;
      primary?: {
        usedPercent?: number;
        remainingPercent?: number;
        windowMinutes?: number;
        resetAt?: string;
      };
      secondary?: {
        usedPercent?: number;
        remainingPercent?: number;
        windowMinutes?: number;
        resetAt?: string;
      };
    };
  }>;
  lastProviderFallbackReason?: string;
  integration: {
    installed: boolean;
    integrationStatePath?: string;
    shimPath?: string;
    realOpenClawPath?: string;
    servicePath?: string;
  };
};

export async function getRouterStatus(params: {
  routerStatePath: string;
  authStorePath?: string;
  integrationStatePath?: string;
  now?: Date;
}): Promise<RouterStatusPayload> {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const state = await loadRouterState(params.routerStatePath);
  const authState = await loadOpenClawAuthStatus(params.authStorePath);
  const currentOrder = state.accounts
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((account) => account.alias);
  const accounts = state.accounts
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((account) => buildStatusAccount(account, authState?.usageStats[account.profileId], nowMs));
  const activeAccounts = accounts
    .filter((account) => account.enabled)
    .filter((account) => account.effectiveStatus !== "disabled")
    .filter((account) => account.effectiveStatus !== "cooldown")
    .map((account) => account.alias);
  const nextCandidate = activeAccounts[0];
  const cooldowns = accounts
    .filter((account) => account.effectiveStatus === "cooldown")
    .map((account) => ({ alias: account.alias, until: account.cooldownUntil }));
  const lastErrorCodes = accounts.map((account) => ({
    alias: account.alias,
    code: account.lastErrorCode
  }));

  const integration = await resolveIntegrationStatus(params.integrationStatePath);
  const authLastGoodProfileId = authState?.lastGood;
  const selectedProfileId =
    nextCandidate && state.accounts.find((account) => account.alias === nextCandidate)?.profileId;

  return {
    currentOrder,
    activeAccounts,
    nextCandidate,
    cooldowns,
    lastErrorCodes,
    authLastGoodProfileId,
    accounts: accounts.map((account) => ({
      ...account,
      selected: account.profileId === selectedProfileId
    })),
    lastProviderFallbackReason: state.lastProviderFallbackReason,
    integration
  };
}

type OpenClawAuthStatus = {
  lastGood?: string;
  usageStats: Record<
    string,
    {
      lastUsed?: number;
      cooldownUntil?: number;
      retryUntil?: number;
      retryReason?: string;
      retryCount?: number;
      disabledUntil?: number;
      disabledReason?: string;
      errorCount?: number;
      failureCounts?: Record<string, number>;
      lastFailureAt?: number;
      quotaSource?: string;
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
      quota?: {
        source?: string;
        fetchedAt?: number;
        planType?: string;
        limitReached?: boolean;
        primary?: {
          usedPercent?: number;
          remainingPercent?: number;
          windowMinutes?: number;
          resetAt?: number;
        };
        secondary?: {
          usedPercent?: number;
          remainingPercent?: number;
          windowMinutes?: number;
          resetAt?: number;
        };
      };
    }
  >;
};

async function loadOpenClawAuthStatus(
  authStorePath: string | undefined
): Promise<OpenClawAuthStatus | undefined> {
  if (!authStorePath) {
    return undefined;
  }
  try {
    const raw = await readFile(authStorePath, "utf8");
    const parsed = JSON.parse(raw) as {
      lastGood?: Record<string, string>;
      usageStats?: OpenClawAuthStatus["usageStats"];
    };
    return {
      lastGood: parsed.lastGood?.["openai-codex"],
      usageStats: parsed.usageStats ?? {}
    };
  } catch (error) {
    if (isOptionalAuthStoreError(error)) {
      return undefined;
    }
    throw error;
  }
}

function buildStatusAccount(
  account: RouterAccount,
  authUsage:
    | {
        lastUsed?: number;
        cooldownUntil?: number;
        retryUntil?: number;
        retryReason?: string;
        retryCount?: number;
        disabledUntil?: number;
        disabledReason?: string;
        errorCount?: number;
        failureCounts?: Record<string, number>;
        lastFailureAt?: number;
        quotaSource?: string;
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
        quota?: {
          source?: string;
          fetchedAt?: number;
          planType?: string;
          limitReached?: boolean;
          primary?: {
            usedPercent?: number;
            remainingPercent?: number;
            windowMinutes?: number;
            resetAt?: number;
          };
          secondary?: {
            usedPercent?: number;
            remainingPercent?: number;
            windowMinutes?: number;
            resetAt?: number;
          };
        };
      }
    | undefined,
  nowMs: number
): RouterStatusPayload["accounts"][number] {
  const configuredStatus = normalizeConfiguredStatus(account, nowMs);
  const routerCooldownMs = normalizeFutureTimestamp(parseIsoTimestamp(account.cooldownUntil), nowMs);
  const authCooldownMs = normalizeFutureTimestamp(authUsage?.cooldownUntil, nowMs);
  const authRetryMs = normalizeFutureTimestamp(authUsage?.retryUntil, nowMs);
  const authDisabledMs = normalizeFutureTimestamp(authUsage?.disabledUntil, nowMs);
  const cooldownUntilMs = maxDefined(routerCooldownMs, authCooldownMs);
  const effectiveStatus = resolveEffectiveStatus({
    enabled: account.enabled,
    configuredStatus,
    cooldownUntilMs,
    disabledUntilMs: authDisabledMs
  });

  return {
    alias: account.alias,
    profileId: account.profileId,
    enabled: account.enabled,
    configuredStatus,
    effectiveStatus,
    cooldownUntil: formatTimestamp(cooldownUntilMs),
    retryUntil: formatTimestamp(authRetryMs),
    retryReason: authUsage?.retryReason,
    disabledUntil: formatTimestamp(authDisabledMs),
    lastErrorCode: resolveEffectiveErrorCode(account, authUsage, effectiveStatus),
    lastSuccessAt: account.lastSuccessAt,
    lastFailureAt: formatTimestamp(
      maxDefined(parseIsoTimestamp(account.lastFailureAt), authUsage?.lastFailureAt)
    ),
    lastUsedAt: formatTimestamp(authUsage?.lastUsed),
    selected: false,
    quota: buildQuotaStatus(authUsage)
  };
}

function buildQuotaStatus(
  authUsage:
    | {
        quotaSource?: string;
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
        quota?: {
          source?: string;
          fetchedAt?: number;
          planType?: string;
          limitReached?: boolean;
          primary?: {
            usedPercent?: number;
            remainingPercent?: number;
            windowMinutes?: number;
            resetAt?: number;
          };
          secondary?: {
            usedPercent?: number;
            remainingPercent?: number;
            windowMinutes?: number;
            resetAt?: number;
          };
        };
      }
    | undefined
): RouterStatusPayload["accounts"][number]["quota"] | undefined {
  if (!authUsage) {
    return undefined;
  }

  const primary = buildQuotaWindow(
    authUsage.quota?.primary
      ? {
          usedPercent: authUsage.quota.primary.usedPercent,
          remainingPercent: authUsage.quota.primary.remainingPercent,
          windowMinutes: authUsage.quota.primary.windowMinutes,
          resetAt: authUsage.quota.primary.resetAt
        }
      : {
          usedPercent: authUsage.primaryUsedPercent,
          remainingPercent: authUsage.primaryRemainingPercent,
          windowMinutes: authUsage.primaryWindowMinutes,
          resetAt: authUsage.primaryResetAt
        }
  );
  const secondary = buildQuotaWindow(
    authUsage.quota?.secondary
      ? {
          usedPercent: authUsage.quota.secondary.usedPercent,
          remainingPercent: authUsage.quota.secondary.remainingPercent,
          windowMinutes: authUsage.quota.secondary.windowMinutes,
          resetAt: authUsage.quota.secondary.resetAt
        }
      : {
          usedPercent: authUsage.secondaryUsedPercent,
          remainingPercent: authUsage.secondaryRemainingPercent,
          windowMinutes: authUsage.secondaryWindowMinutes,
          resetAt: authUsage.secondaryResetAt
        }
  );

  const source = authUsage.quota?.source ?? authUsage.quotaSource;
  const fetchedAt = authUsage.quota?.fetchedAt ?? authUsage.quotaFetchedAt;
  const planType = authUsage.quota?.planType ?? authUsage.planType;
  const limitReached = authUsage.quota?.limitReached ?? authUsage.limitReached;
  const hasQuota =
    source !== undefined ||
    fetchedAt !== undefined ||
    planType !== undefined ||
    limitReached !== undefined ||
    primary !== undefined ||
    secondary !== undefined;
  if (!hasQuota) {
    return undefined;
  }

  return {
    source,
    fetchedAt: formatTimestamp(fetchedAt),
    planType,
    limitReached,
    primary,
    secondary
  };
}

function buildQuotaWindow(params: {
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetAt?: number;
}):
  | {
      usedPercent?: number;
      remainingPercent?: number;
      windowMinutes?: number;
      resetAt?: string;
    }
  | undefined {
  const hasValue =
    params.usedPercent !== undefined ||
    params.remainingPercent !== undefined ||
    params.windowMinutes !== undefined ||
    params.resetAt !== undefined;
  if (!hasValue) {
    return undefined;
  }

  return {
    usedPercent: params.usedPercent,
    remainingPercent: params.remainingPercent,
    windowMinutes: params.windowMinutes,
    resetAt: formatTimestamp(params.resetAt)
  };
}

function normalizeConfiguredStatus(account: RouterAccount, nowMs: number): AccountStatus {
  if (account.status !== "cooldown") {
    return account.status;
  }
  const cooldownMs = parseIsoTimestamp(account.cooldownUntil);
  if (cooldownMs !== undefined && cooldownMs <= nowMs) {
    return "healthy";
  }
  return "cooldown";
}

function resolveEffectiveStatus(params: {
  enabled: boolean;
  configuredStatus: AccountStatus;
  cooldownUntilMs?: number;
  disabledUntilMs?: number;
}): AccountStatus {
  if (!params.enabled || params.configuredStatus === "disabled") {
    return "disabled";
  }
  if (params.disabledUntilMs !== undefined) {
    return "disabled";
  }
  if (params.configuredStatus === "cooldown" || params.cooldownUntilMs !== undefined) {
    return "cooldown";
  }
  return params.configuredStatus;
}

function resolveEffectiveErrorCode(
  account: RouterAccount,
  authUsage:
    | {
        disabledReason?: string;
        retryReason?: string;
        limitReached?: boolean;
        quota?: {
          limitReached?: boolean;
        };
      }
    | undefined,
  effectiveStatus: AccountStatus
): string | undefined {
  if (account.lastErrorCode) {
    return account.lastErrorCode;
  }
  if (effectiveStatus === "disabled" && authUsage?.disabledReason) {
    return authUsage.disabledReason;
  }
  if (effectiveStatus === "cooldown" && authUsage?.retryReason) {
    return authUsage.retryReason;
  }
  if (effectiveStatus === "cooldown" && isQuotaLimitReached(authUsage)) {
    return "rate_limit";
  }
  return undefined;
}

function parseIsoTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeFutureTimestamp(value: number | undefined, nowMs: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value > nowMs ? value : undefined;
}

function maxDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.max(left, right);
}

function formatTimestamp(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function isOptionalAuthStoreError(error: unknown): boolean {
  return isFileSystemError(error, ["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR"]) || isMalformedJson(error);
}

function isMalformedJson(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function isFileSystemError(error: unknown, allowedCodes: string[]): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      allowedCodes.includes((error as { code: string }).code)
  );
}

function isQuotaLimitReached(
  authUsage:
    | {
        limitReached?: boolean;
        quota?: {
          limitReached?: boolean;
        };
      }
    | undefined
): boolean {
  return authUsage?.quota?.limitReached === true || authUsage?.limitReached === true;
}

async function resolveIntegrationStatus(
  integrationStatePath: string | undefined
): Promise<RouterStatusPayload["integration"]> {
  if (!integrationStatePath) {
    return { installed: false };
  }

  const state = await loadIntegrationState(integrationStatePath);
  if (!state) {
    return {
      installed: false,
      integrationStatePath
    };
  }

  return {
    installed: true,
    integrationStatePath,
    shimPath: state.shimPath,
    realOpenClawPath: state.realOpenClawPath,
    servicePath: state.servicePath
  };
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show router status")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const integrationStatePath = resolveOptionalIntegrationStatePath(
        opts.integrationState as string | undefined
      );
      const integrationState = integrationStatePath
        ? await loadIntegrationState(integrationStatePath)
        : undefined;

      const payload = await getRouterStatus({
        routerStatePath: resolveRouterStatePath(
          (opts.routerState as string | undefined) ?? integrationState?.routerStatePath
        ),
        authStorePath: resolveOptionalStatusAuthStorePath(
          (opts.authStore as string | undefined) ?? integrationState?.authStorePath
        ),
        integrationStatePath
      });
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(`Current order: ${payload.currentOrder.join(", ") || "(none)"}`);
      console.log(`Active accounts: ${payload.activeAccounts.join(", ") || "(none)"}`);
      console.log(`Next candidate: ${payload.nextCandidate ?? "(none)"}`);
      if (payload.authLastGoodProfileId) {
        console.log(`OpenClaw last good profile: ${payload.authLastGoodProfileId}`);
      }
      for (const account of payload.accounts) {
        console.log(
          `- ${account.alias}: ${account.profileId} configured=${account.configuredStatus} effective=${account.effectiveStatus}${account.selected ? " selected" : ""}`
        );
      }
      if (payload.lastProviderFallbackReason) {
        console.log(`Last provider fallback reason: ${payload.lastProviderFallbackReason}`);
      }
      if (payload.integration.installed) {
        console.log(`Integration: installed (${payload.integration.shimPath})`);
      } else {
        console.log("Integration: not installed");
      }
    });
}

function resolveOptionalStatusAuthStorePath(explicit?: string): string | undefined {
  const raw = explicit?.trim();
  if (raw) {
    return resolveAuthStorePath(raw);
  }
  try {
    return resolveAuthStorePath();
  } catch {
    return undefined;
  }
}
