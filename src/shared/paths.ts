import path from "node:path";
import { detectIntegrationPlatform, resolveHomeDir } from "../integration/discovery.js";
import { resolveIntegrationPaths } from "../integration/paths.js";
import { resolveDefaultOpenClawAuthStorePath } from "../router/openclaw_paths.js";

export function resolveRouterStatePath(explicit?: string): string {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  return path.resolve(process.cwd(), "config", "accounts.json");
}

export function resolveAuthStorePath(explicit?: string): string {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  return resolveDefaultOpenClawAuthStorePath();
}

export function resolveIntegrationStatePath(explicit?: string): string {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  const homeDir = resolveHomeDir();
  const platform = detectIntegrationPlatform();
  return resolveIntegrationPaths(homeDir, platform).integrationStatePath;
}

export function resolveOptionalIntegrationStatePath(explicit?: string): string | undefined {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }

  try {
    const homeDir = resolveHomeDir();
    const platform = detectIntegrationPlatform();
    return resolveIntegrationPaths(homeDir, platform).integrationStatePath;
  } catch {
    return undefined;
  }
}
