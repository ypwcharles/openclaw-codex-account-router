import { readFile } from "node:fs/promises";
import { execa } from "execa";
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

export async function resolveOpenClawBinaryPath(): Promise<string> {
  const result = await execa("which", ["openclaw"], { reject: false });
  const binaryPath = result.stdout.trim();
  if (result.exitCode !== 0 || !binaryPath) {
    throw new Error("openclaw binary not found in PATH");
  }
  return binaryPath;
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
