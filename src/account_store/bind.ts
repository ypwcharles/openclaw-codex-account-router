import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadRouterState, saveRouterState } from "./store.js";
import type { RouterAccount, RouterState } from "./types.js";
import {
  clearProfileCooldown,
  clearProfileFailureState,
  mirrorQuotaSnapshotToOpenClaw,
  syncCodexOrder
} from "../router/openclaw_auth_store.js";
import { fetchCodexUsageSnapshot, type CodexQuotaSnapshot } from "../router/codex_usage_api.js";
import { selectEligibleAccounts } from "../router/select_account.js";

type OpenClawAuthProfile = {
  provider?: string;
  refresh?: string;
  access?: string;
};

type OpenClawAuthStore = {
  profiles?: Record<string, OpenClawAuthProfile>;
};

export async function bindAccount(
  params: {
    alias: string;
    profileId: string;
    routerStatePath: string;
    authStorePath: string;
    priority?: number;
    forceDefault?: boolean;
  },
  deps?: {
    fetchCodexUsage?: (params: {
      authStorePath: string;
      profileId: string;
      now: Date;
    }) => Promise<CodexQuotaSnapshot | undefined>;
  }
): Promise<{ account: RouterAccount; state: RouterState }> {
  const alias = params.alias.trim();
  const profileId = params.profileId.trim();
  if (!alias) {
    throw new Error("alias is required");
  }
  if (!profileId) {
    throw new Error("profileId is required");
  }

  const authStore = await loadOpenClawAuthStore(params.authStorePath);
  const profile = authStore.profiles?.[profileId];
  if (!profile) {
    throw new Error(`profile "${profileId}" not found in auth store`);
  }
  if (profile.provider !== "openai-codex") {
    throw new Error(`profile "${profileId}" is not an openai-codex profile`);
  }

  const isDefaultProfile = profileId === "openai-codex:default";
  if (isDefaultProfile && !params.forceDefault) {
    throw new Error(
      "ambiguous default profile binding blocked; pass --force-default to bind openai-codex:default"
    );
  }

  const state = await loadRouterState(params.routerStatePath);
  const existing = state.accounts.find((account) => account.alias === alias);
  const priority = params.priority ?? existing?.priority ?? resolveNextPriority(state.accounts);
  const sameProfile = existing?.profileId === profileId;

  const account: RouterAccount = {
    alias,
    profileId,
    provider: "openai-codex",
    priority,
    status: sameProfile ? (existing?.status ?? "unknown") : "unknown",
    enabled: existing?.enabled ?? true,
    lastSuccessAt: sameProfile ? existing?.lastSuccessAt : undefined,
    lastFailureAt: sameProfile ? existing?.lastFailureAt : undefined,
    lastErrorCode: sameProfile ? existing?.lastErrorCode : undefined,
    cooldownUntil: sameProfile ? existing?.cooldownUntil : undefined
  };
  if (isDefaultProfile) {
    account.defaultProfileFingerprint = resolveProfileFingerprint(profile);
  }

  const fetchCodexUsage =
    deps?.fetchCodexUsage ??
    (async ({ authStorePath, profileId, now }) =>
      await fetchCodexUsageSnapshot({ authStorePath, profileId, now }));
  const hydration = await hydrateBoundAccount({
    account,
    sameProfile,
    authStorePath: params.authStorePath,
    fetchCodexUsage
  });
  const finalAccount = hydration.account;

  const nextAccounts = state.accounts
    .filter((item) => item.alias !== alias)
    .concat(finalAccount)
    .sort((a, b) => a.priority - b.priority);
  const nextState: RouterState = {
    ...state,
    accounts: nextAccounts
  };
  await saveRouterState(params.routerStatePath, nextState);
  if (hydration.snapshot) {
    await mirrorQuotaSnapshotToOpenClaw(params.authStorePath, {
      profileId: finalAccount.profileId,
      snapshot: hydration.snapshot,
      now: hydration.now
    });
  }
  await syncCodexOrder(
    params.authStorePath,
    resolveRoutableProfileOrder(nextAccounts, hydration.now)
  );

  return { account: finalAccount, state: nextState };
}

export async function listAccounts(routerStatePath: string): Promise<RouterAccount[]> {
  const state = await loadRouterState(routerStatePath);
  return [...state.accounts].sort((a, b) => a.priority - b.priority);
}

export async function setAccountEnabled(params: {
  routerStatePath: string;
  authStorePath: string;
  alias: string;
  enabled: boolean;
}): Promise<RouterState> {
  const state = await loadRouterState(params.routerStatePath);
  const index = state.accounts.findIndex((item) => item.alias === params.alias);
  if (index < 0) {
    throw new Error(`account "${params.alias}" not found`);
  }
  const current = state.accounts[index];
  const next: RouterAccount = {
    ...current,
    enabled: params.enabled
  };
  if (params.enabled && current.status === "disabled") {
    next.status = "healthy";
    next.cooldownUntil = undefined;
    next.lastErrorCode = undefined;
  }
  state.accounts[index] = next;
  state.accounts.sort((a, b) => a.priority - b.priority);
  await saveRouterState(params.routerStatePath, state);
  await syncCodexOrder(
    params.authStorePath,
    state.accounts.filter((item) => item.enabled).map((item) => item.profileId)
  );
  if (params.enabled) {
    await clearProfileFailureState(params.authStorePath, next.profileId);
  }
  return state;
}

export async function setAccountOrderByAlias(params: {
  routerStatePath: string;
  authStorePath: string;
  aliases: string[];
}): Promise<RouterState> {
  const desired = params.aliases.map((alias) => alias.trim()).filter(Boolean);
  if (desired.length === 0) {
    throw new Error("at least one alias is required");
  }

  const state = await loadRouterState(params.routerStatePath);
  const byAlias = new Map(state.accounts.map((item) => [item.alias, item]));
  for (const alias of desired) {
    if (!byAlias.has(alias)) {
      throw new Error(`account "${alias}" not found`);
    }
  }

  const ordered: RouterAccount[] = [];
  for (const alias of desired) {
    const account = byAlias.get(alias);
    if (account) {
      ordered.push(account);
      byAlias.delete(alias);
    }
  }
  for (const account of state.accounts.sort((a, b) => a.priority - b.priority)) {
    if (byAlias.has(account.alias)) {
      ordered.push(account);
    }
  }

  const nextAccounts = ordered.map((account, index) => ({
    ...account,
    priority: (index + 1) * 10
  }));

  const nextState: RouterState = {
    ...state,
    accounts: nextAccounts
  };
  await saveRouterState(params.routerStatePath, nextState);
  await syncCodexOrder(
    params.authStorePath,
    nextAccounts.filter((item) => item.enabled).map((item) => item.profileId)
  );
  return nextState;
}

async function hydrateBoundAccount(params: {
  account: RouterAccount;
  sameProfile: boolean;
  authStorePath: string;
  fetchCodexUsage: (params: {
    authStorePath: string;
    profileId: string;
    now: Date;
  }) => Promise<CodexQuotaSnapshot | undefined>;
}): Promise<{ account: RouterAccount; snapshot?: CodexQuotaSnapshot; now: Date }> {
  const now = new Date();
  if (params.sameProfile && params.account.status !== "unknown") {
    return {
      account: params.account,
      now
    };
  }

  let snapshot: CodexQuotaSnapshot | undefined;
  try {
    snapshot = await params.fetchCodexUsage({
      authStorePath: params.authStorePath,
      profileId: params.account.profileId,
      now
    });
  } catch {
    return {
      account: params.account,
      now
    };
  }

  if (!snapshot) {
    return {
      account: params.account,
      now
    };
  }

  const cooldownMs =
    typeof snapshot.cooldownUntil === "number" &&
    Number.isFinite(snapshot.cooldownUntil) &&
    snapshot.cooldownUntil > now.getTime()
      ? snapshot.cooldownUntil
      : undefined;

  return {
    account: {
      ...params.account,
      status: cooldownMs !== undefined ? "cooldown" : "healthy",
      cooldownUntil: cooldownMs !== undefined ? new Date(cooldownMs).toISOString() : undefined,
      lastErrorCode: cooldownMs !== undefined ? "rate_limit" : undefined,
      lastSuccessAt: cooldownMs !== undefined ? undefined : params.account.lastSuccessAt,
      lastFailureAt: cooldownMs !== undefined ? now.toISOString() : params.account.lastFailureAt
    },
    snapshot,
    now
  };
}

function resolveRoutableProfileOrder(accounts: RouterAccount[], now: Date): string[] {
  return selectEligibleAccounts(accounts, now).map((account) => account.profileId);
}

export async function clearAccountCooldown(params: {
  routerStatePath: string;
  authStorePath: string;
  alias: string;
}): Promise<RouterState> {
  const state = await loadRouterState(params.routerStatePath);
  const index = state.accounts.findIndex((item) => item.alias === params.alias);
  if (index < 0) {
    throw new Error(`account "${params.alias}" not found`);
  }
  const current = state.accounts[index];
  state.accounts[index] = {
    ...current,
    status: current.status === "cooldown" ? "healthy" : current.status,
    cooldownUntil: undefined,
    lastErrorCode: current.status === "cooldown" ? undefined : current.lastErrorCode
  };
  await saveRouterState(params.routerStatePath, state);
  await clearProfileCooldown(params.authStorePath, current.profileId);
  return state;
}

function resolveNextPriority(accounts: RouterAccount[]): number {
  const max = accounts.reduce((acc, item) => Math.max(acc, item.priority), 0);
  return max > 0 ? max + 10 : 10;
}

function resolveProfileFingerprint(profile: OpenClawAuthProfile): string {
  const raw = profile.refresh || profile.access || "openai-codex:default";
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

async function loadOpenClawAuthStore(authStorePath: string): Promise<OpenClawAuthStore> {
  const raw = await readFile(authStorePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as OpenClawAuthStore;
}
