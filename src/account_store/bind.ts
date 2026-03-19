import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadRouterState, saveRouterState } from "./store.js";
import type { RouterAccount, RouterState } from "./types.js";
import { clearProfileFailureState, syncCodexOrder } from "../router/openclaw_auth_store.js";

type OpenClawAuthProfile = {
  provider?: string;
  refresh?: string;
  access?: string;
};

type OpenClawAuthStore = {
  profiles?: Record<string, OpenClawAuthProfile>;
};

export async function bindAccount(params: {
  alias: string;
  profileId: string;
  routerStatePath: string;
  authStorePath: string;
  priority?: number;
  forceDefault?: boolean;
}): Promise<{ account: RouterAccount; state: RouterState }> {
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

  const account: RouterAccount = {
    alias,
    profileId,
    provider: "openai-codex",
    priority,
    status: existing?.status ?? "unknown",
    enabled: existing?.enabled ?? true,
    lastSuccessAt: existing?.lastSuccessAt,
    lastFailureAt: existing?.lastFailureAt,
    lastErrorCode: existing?.lastErrorCode,
    cooldownUntil: existing?.cooldownUntil
  };
  if (isDefaultProfile) {
    account.defaultProfileFingerprint = resolveProfileFingerprint(profile);
  }

  const nextAccounts = state.accounts
    .filter((item) => item.alias !== alias)
    .concat(account)
    .sort((a, b) => a.priority - b.priority);
  const nextState: RouterState = {
    ...state,
    accounts: nextAccounts
  };
  await saveRouterState(params.routerStatePath, nextState);
  await syncCodexOrder(
    params.authStorePath,
    nextAccounts
      .filter((item) => item.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((item) => item.profileId)
  );
  return { account, state: nextState };
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
  await clearProfileFailureState(params.authStorePath, current.profileId);
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
