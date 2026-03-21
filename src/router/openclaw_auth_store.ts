import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import lockfile from "proper-lockfile";
import {
  mirrorFailureStats,
  type MirroredFailureReason,
  type OpenClawUsageStats
} from "./openclaw_usage_mirror.js";
import type { CodexQuotaSnapshot } from "./codex_usage_api.js";
import { getOpenClawAuthLockPath } from "./openclaw_auth_lock.js";
import {
  resolveDefaultOpenClawAuthStorePath,
  resolveDefaultOpenClawGatewayServicePath,
  resolveDefaultOpenClawSessionStorePath
} from "./openclaw_paths.js";

type OpenClawStore = {
  version: number;
  profiles: Record<string, unknown>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, OpenClawUsageStats>;
};

const OPENAI_CODEX_PROVIDER = "openai-codex";

type SessionEntry = {
  updatedAt?: number;
  compactionCount?: number;
  modelProvider?: string;
  authProfileOverride?: string;
  authProfileOverrideSource?: string;
  authProfileOverrideCompactionCount?: number;
};

export async function syncCodexOrder(
  authStorePath: string,
  orderedProfileIds: string[]
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    store.order = store.order ?? {};
    store.order[OPENAI_CODEX_PROVIDER] = [...orderedProfileIds];
  });
  try {
    await syncOpenClawRuntimeState(authStorePath, orderedProfileIds);
  } catch {
    // Best-effort only: routing should still proceed when optional runtime sync drifts.
  }
}

export async function mirrorSuccessToOpenClaw(
  authStorePath: string,
  params: {
    profileId: string;
    now: Date;
  }
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    store.lastGood = store.lastGood ?? {};
    store.lastGood[OPENAI_CODEX_PROVIDER] = params.profileId;
    store.usageStats = store.usageStats ?? {};
    const existing = store.usageStats[params.profileId] ?? {};
    store.usageStats[params.profileId] = {
      ...existing,
      lastUsed: params.now.getTime(),
      cooldownUntil: undefined,
      disabledUntil: undefined,
      disabledReason: undefined,
      retryUntil: undefined,
      retryReason: undefined,
      retryCount: undefined,
      errorCount: 0
    };
  });
}

export async function mirrorFailureToOpenClaw(
  authStorePath: string,
  params: {
    profileId: string;
    reason: MirroredFailureReason;
    now: Date;
    cooldownUntilMs?: number;
    quotaSnapshot?: CodexQuotaSnapshot;
  }
): Promise<OpenClawUsageStats> {
  return await updateOpenClawStore(authStorePath, (store) => {
    store.usageStats = store.usageStats ?? {};
    const nextStats = mirrorFailureStats({
      existing: store.usageStats[params.profileId],
      reason: params.reason,
      nowMs: params.now.getTime(),
      cooldownUntilOverrideMs: params.cooldownUntilMs,
      quotaSnapshot: params.quotaSnapshot
    });
    store.usageStats[params.profileId] = nextStats;
    if (params.reason === "auth_permanent" || params.reason === "billing") {
      if (store.lastGood?.[OPENAI_CODEX_PROVIDER] === params.profileId) {
        delete store.lastGood[OPENAI_CODEX_PROVIDER];
      }
    }
    return nextStats;
  });
}

export async function clearProfileFailureState(
  authStorePath: string,
  profileId: string
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    if (!store.usageStats?.[profileId]) {
      return;
    }
    const existing = store.usageStats[profileId] ?? {};
    store.usageStats[profileId] = {
      ...existing,
      cooldownUntil: undefined,
      disabledUntil: undefined,
      disabledReason: undefined,
      retryUntil: undefined,
      retryReason: undefined,
      retryCount: undefined
    };
  });
}

export async function clearProfileCooldown(
  authStorePath: string,
  profileId: string
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    if (!store.usageStats?.[profileId]) {
      return;
    }
    const existing = store.usageStats[profileId] ?? {};
    store.usageStats[profileId] = {
      ...existing,
      cooldownUntil: undefined,
      retryUntil: undefined,
      retryReason: undefined,
      retryCount: undefined
    };
  });
}

export async function syncAutoSessionAuthOverrides(
  sessionStorePath: string,
  orderedProfileIds: string[]
): Promise<boolean> {
  return await updateSessionStore(sessionStorePath, (store) => {
    let changed = false;
    for (const value of Object.values(store)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const entry = value as SessionEntry;
      if (entry.modelProvider !== OPENAI_CODEX_PROVIDER) {
        continue;
      }
      if (entry.authProfileOverrideSource === "user") {
        continue;
      }

      if (orderedProfileIds.length === 0) {
        if (
          entry.authProfileOverride !== undefined ||
          entry.authProfileOverrideSource !== undefined ||
          entry.authProfileOverrideCompactionCount !== undefined
        ) {
          delete entry.authProfileOverride;
          delete entry.authProfileOverrideSource;
          delete entry.authProfileOverrideCompactionCount;
          entry.updatedAt = Date.now();
          changed = true;
        }
        continue;
      }

      const nextProfileId = orderedProfileIds[0];
      const nextCompactionCount = entry.compactionCount ?? 0;
      if (
        entry.authProfileOverride === nextProfileId &&
        entry.authProfileOverrideSource === "auto" &&
        entry.authProfileOverrideCompactionCount === nextCompactionCount
      ) {
        continue;
      }
      entry.authProfileOverride = nextProfileId;
      entry.authProfileOverrideSource = "auto";
      entry.authProfileOverrideCompactionCount = nextCompactionCount;
      entry.updatedAt = Date.now();
      changed = true;
    }
    return changed;
  });
}

async function syncOpenClawRuntimeState(
  authStorePath: string,
  orderedProfileIds: string[]
): Promise<void> {
  if (process.env.OPENCLAW_ROUTER_SKIP_RUNTIME_SYNC === "1") {
    return;
  }
  if (!isDefaultAuthStorePath(authStorePath)) {
    return;
  }

  const sessionStorePath = resolveDefaultOpenClawSessionStorePath();
  if (!(await pathExists(sessionStorePath))) {
    return;
  }

  const changed = await syncAutoSessionAuthOverrides(sessionStorePath, orderedProfileIds);
  if (!changed) {
    return;
  }

  await restartGatewayServiceIfActive();
}

async function updateOpenClawStore<T>(
  authStorePath: string,
  updater: (store: OpenClawStore) => T
): Promise<T> {
  const dir = path.dirname(authStorePath);
  const lockPath = getOpenClawAuthLockPath(authStorePath);
  const tempPath = `${authStorePath}.tmp`;

  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, {
    lockfilePath: lockPath,
    retries: {
      retries: 5,
      factor: 1.4,
      minTimeout: 50,
      maxTimeout: 300
    }
  });

  try {
    const store = await loadOpenClawStore(authStorePath);
    const result = updater(store);
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, authStorePath);
    return result;
  } finally {
    await release();
  }
}

async function updateSessionStore(
  sessionStorePath: string,
  updater: (store: Record<string, unknown>) => boolean
): Promise<boolean> {
  const dir = path.dirname(sessionStorePath);
  const lockPath = path.join(dir, ".sessions.lock");
  const tempPath = `${sessionStorePath}.tmp`;

  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, {
    lockfilePath: lockPath,
    retries: {
      retries: 5,
      factor: 1.4,
      minTimeout: 50,
      maxTimeout: 300
    }
  });

  try {
    const store = await loadSessionStore(sessionStorePath);
    const changed = updater(store);
    if (!changed) {
      return false;
    }
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, sessionStorePath);
    return true;
  } finally {
    await release();
  }
}

async function loadOpenClawStore(authStorePath: string): Promise<OpenClawStore> {
  try {
    const raw = await readFile(authStorePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeOpenClawStore(parsed);
  } catch (error) {
    if (isFileNotFound(error)) {
      return { version: 1, profiles: {} };
    }
    throw error;
  }
}

async function loadSessionStore(sessionStorePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(sessionStorePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isFileNotFound(error)) {
      return {};
    }
    throw error;
  }
}

function normalizeOpenClawStore(value: unknown): OpenClawStore {
  if (!value || typeof value !== "object") {
    return { version: 1, profiles: {} };
  }
  const obj = value as Record<string, unknown>;
  const profiles =
    obj.profiles && typeof obj.profiles === "object"
      ? (obj.profiles as Record<string, unknown>)
      : {};
  const version = typeof obj.version === "number" ? obj.version : 1;

  const store: OpenClawStore = {
    version,
    profiles
  };
  if (obj.order && typeof obj.order === "object") {
    store.order = obj.order as Record<string, string[]>;
  }
  if (obj.lastGood && typeof obj.lastGood === "object") {
    store.lastGood = obj.lastGood as Record<string, string>;
  }
  if (obj.usageStats && typeof obj.usageStats === "object") {
    store.usageStats = obj.usageStats as OpenClawStore["usageStats"];
  }
  return store;
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}

function isDefaultAuthStorePath(authStorePath: string): boolean {
  try {
    return path.resolve(authStorePath) === path.resolve(resolveDefaultOpenClawAuthStorePath());
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function restartGatewayServiceIfActive(): Promise<void> {
  if (process.platform !== "linux") {
    return;
  }
  if (!(await pathExists(resolveDefaultOpenClawGatewayServicePath()))) {
    return;
  }

  const active = await execa("systemctl", ["--user", "is-active", "openclaw-gateway.service"], {
    reject: false
  });
  if (active.exitCode !== 0) {
    return;
  }

  await execa("systemctl", ["--user", "restart", "openclaw-gateway.service"], {
    reject: false
  });
}
