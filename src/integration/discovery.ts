import { access, constants, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { IntegrationPlatform } from "./types.js";

type OpenClawAuthProfile = {
  provider?: string;
};

type OpenClawAuthStore = {
  profiles?: Record<string, OpenClawAuthProfile>;
};

export function resolveHomeDir(env = process.env): string {
  const home = env.HOME?.trim();
  if (!home) {
    throw new Error("HOME is not set; cannot resolve integration paths");
  }
  return home;
}

export function detectIntegrationPlatform(raw = process.platform): IntegrationPlatform {
  if (raw === "darwin" || raw === "linux") {
    return raw;
  }
  throw new Error(`unsupported platform: ${raw}`);
}

export async function resolveOpenClawBinaryPath(params?: {
  excludePaths?: string[];
}): Promise<string> {
  const pathEnv = process.env.PATH ?? "";
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
  const excluded = new Set(
    (params?.excludePaths ?? []).map((item) => path.resolve(item))
  );

  for (const dir of pathEntries) {
    const candidate = path.join(dir, "openclaw");
    const resolved = await resolveExecutablePath(candidate);
    if (!resolved) {
      continue;
    }
    if (excluded.has(resolved) || excluded.has(path.resolve(candidate))) {
      continue;
    }
    return resolved;
  }

  throw new Error("openclaw binary not found in PATH");
}

export async function discoverOpenClawProfiles(authStorePath: string): Promise<string[]> {
  const raw = await readFile(authStorePath, "utf8");
  const parsed = JSON.parse(raw) as OpenClawAuthStore;
  const profiles = parsed.profiles ?? {};
  return Object.entries(profiles)
    .filter(([profileId, profile]) => {
      const provider = profile?.provider;
      return profileId.startsWith("openai-codex:") && provider === "openai-codex";
    })
    .map(([profileId]) => profileId)
    .sort();
}

async function resolveExecutablePath(candidate: string): Promise<string | undefined> {
  try {
    await access(candidate, constants.X_OK);
    return await realpath(candidate).catch(() => path.resolve(candidate));
  } catch {
    return undefined;
  }
}
