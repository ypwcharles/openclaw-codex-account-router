import { access, constants, readFile, stat } from "node:fs/promises";
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
  const excludedRoots = await Promise.all(
    (params?.excludePaths ?? []).map(async (item) => await normalizePath(item))
  );

  for (const dir of pathEntries) {
    const candidate = path.join(dir, "openclaw");
    const resolved = await resolveExecutablePath(candidate);
    if (!resolved) {
      continue;
    }
    const candidatePath = await normalizePath(candidate);
    if (
      excludedRoots.some(
        (root) => isSamePathOrDescendant(candidatePath, root) || isSamePathOrDescendant(resolved, root)
      )
    ) {
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
    return await normalizePath(candidate);
  } catch {
    return undefined;
  }
}

async function normalizePath(targetPath: string): Promise<string> {
  // Use realpath only when needed; fall back to resolve to avoid
  // hangs on non-existent or WSL-accessible Windows paths.
  try {
    return await stat(targetPath).then(() => path.resolve(targetPath));
  } catch {
    return path.resolve(targetPath);
  }
}

function isSamePathOrDescendant(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true;
  }
  const relative = path.relative(rootPath, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
