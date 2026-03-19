import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { mirrorFailureStats, type MirroredFailureReason } from "./openclaw_usage_mirror.js";

type OpenClawStore = {
  version: number;
  profiles: Record<string, unknown>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<
    string,
    {
      lastUsed?: number;
      cooldownUntil?: number;
      disabledUntil?: number;
      disabledReason?: MirroredFailureReason;
      errorCount?: number;
      failureCounts?: Partial<Record<MirroredFailureReason, number>>;
      lastFailureAt?: number;
    }
  >;
};

const OPENAI_CODEX_PROVIDER = "openai-codex";

export async function syncCodexOrder(
  authStorePath: string,
  orderedProfileIds: string[]
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    store.order = store.order ?? {};
    store.order[OPENAI_CODEX_PROVIDER] = [...orderedProfileIds];
  });
}

export async function mirrorFailureToOpenClaw(
  authStorePath: string,
  params: {
    profileId: string;
    reason: MirroredFailureReason;
    now: Date;
  }
): Promise<void> {
  await updateOpenClawStore(authStorePath, (store) => {
    store.usageStats = store.usageStats ?? {};
    store.usageStats[params.profileId] = mirrorFailureStats({
      existing: store.usageStats[params.profileId],
      reason: params.reason,
      nowMs: params.now.getTime()
    });
    if (params.reason === "auth_permanent" || params.reason === "billing") {
      if (store.lastGood?.[OPENAI_CODEX_PROVIDER] === params.profileId) {
        delete store.lastGood[OPENAI_CODEX_PROVIDER];
      }
    }
  });
}

async function updateOpenClawStore(
  authStorePath: string,
  updater: (store: OpenClawStore) => void
): Promise<void> {
  const dir = path.dirname(authStorePath);
  const lockPath = path.join(dir, ".openclaw-auth-profiles.lock");
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
    updater(store);
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, authStorePath);
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
