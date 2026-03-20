import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_DEFAULT_PROFILE_ID = "openai-codex:default";
const OPENAI_PROFILE_CLAIM_PATH = "https://api.openai.com/profile";

type OpenClawAuthProfile = {
  provider?: string;
  access?: string;
  refresh?: string;
};

type OpenClawAuthStore = {
  version?: number;
  profiles?: Record<string, OpenClawAuthProfile>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
};

export async function normalizeCodexAuthProfiles(
  authStorePath: string
): Promise<Record<string, string>> {
  return await updateAuthStore(authStorePath, (store) => {
    const profile = store.profiles?.[OPENAI_CODEX_DEFAULT_PROFILE_ID];
    if (!profile || profile.provider !== OPENAI_CODEX_PROVIDER) {
      return {} as Record<string, string>;
    }

    const email = extractEmailFromAccessToken(profile.access);
    if (!email) {
      return {} as Record<string, string>;
    }

    const nextProfileId = `${OPENAI_CODEX_PROVIDER}:${email}`;
    if (nextProfileId === OPENAI_CODEX_DEFAULT_PROFILE_ID) {
      return {} as Record<string, string>;
    }

    store.profiles = store.profiles ?? {};
    const existingTarget = store.profiles[nextProfileId];
    if (existingTarget && !profilesEquivalent(existingTarget, profile)) {
      return {} as Record<string, string>;
    }

    store.profiles[nextProfileId] = existingTarget ?? profile;
    delete store.profiles[OPENAI_CODEX_DEFAULT_PROFILE_ID];

    if (store.order?.[OPENAI_CODEX_PROVIDER]) {
      store.order[OPENAI_CODEX_PROVIDER] = dedupeProfileIds(
        store.order[OPENAI_CODEX_PROVIDER].map((profileId) =>
          profileId === OPENAI_CODEX_DEFAULT_PROFILE_ID ? nextProfileId : profileId
        )
      );
    }

    if (store.lastGood?.[OPENAI_CODEX_PROVIDER] === OPENAI_CODEX_DEFAULT_PROFILE_ID) {
      store.lastGood[OPENAI_CODEX_PROVIDER] = nextProfileId;
    }

    if (store.usageStats?.[OPENAI_CODEX_DEFAULT_PROFILE_ID] !== undefined) {
      store.usageStats[nextProfileId] =
        store.usageStats[nextProfileId] ?? store.usageStats[OPENAI_CODEX_DEFAULT_PROFILE_ID];
      delete store.usageStats[OPENAI_CODEX_DEFAULT_PROFILE_ID];
    }

    return {
      [OPENAI_CODEX_DEFAULT_PROFILE_ID]: nextProfileId
    } satisfies Record<string, string>;
  });
}

async function updateAuthStore<T>(
  authStorePath: string,
  updater: (store: OpenClawAuthStore) => T
): Promise<T> {
  const dir = path.dirname(authStorePath);
  const lockPath = path.join(dir, ".auth-store-setup.lock");
  const tempPath = `${authStorePath}.tmp`;

  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, {
    lockfilePath: lockPath,
    retries: {
      retries: 4,
      factor: 1.4,
      minTimeout: 50,
      maxTimeout: 250
    }
  });

  try {
    const store = await loadOpenClawAuthStore(authStorePath);
    const result = updater(store);
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, authStorePath);
    return result;
  } finally {
    await release();
  }
}

async function loadOpenClawAuthStore(authStorePath: string): Promise<OpenClawAuthStore> {
  const raw = await readFile(authStorePath, "utf8");
  const parsed = JSON.parse(raw) as OpenClawAuthStore;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function extractEmailFromAccessToken(token: string | undefined): string | undefined {
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
      [OPENAI_PROFILE_CLAIM_PATH]?: { email?: string };
      email?: string;
    };
    const email =
      parsed?.[OPENAI_PROFILE_CLAIM_PATH]?.email?.trim() ?? parsed.email?.trim();
    return email ? email.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function profilesEquivalent(left: OpenClawAuthProfile, right: OpenClawAuthProfile): boolean {
  return left.provider === right.provider && left.access === right.access && left.refresh === right.refresh;
}

function dedupeProfileIds(profileIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const profileId of profileIds) {
    if (seen.has(profileId)) {
      continue;
    }
    seen.add(profileId);
    deduped.push(profileId);
  }
  return deduped;
}
