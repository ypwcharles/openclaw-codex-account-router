import path from "node:path";
import { detectIntegrationPlatform, resolveHomeDir } from "../integration/discovery.js";
import { resolveIntegrationPaths } from "../integration/paths.js";
import { loadIntegrationState } from "../integration/store.js";
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

export async function resolveInstalledStatePaths(params: {
  routerStatePath?: string;
  authStorePath?: string;
  integrationStatePath?: string;
}): Promise<{
  integrationStatePath?: string;
  routerStatePath: string;
  authStorePath: string;
}> {
  const integrationStatePath = resolveOptionalIntegrationStatePath(params.integrationStatePath);
  const integrationState = integrationStatePath
    ? await loadIntegrationState(integrationStatePath)
    : undefined;

  return {
    integrationStatePath,
    routerStatePath: resolveRouterStatePath(
      params.routerStatePath ?? integrationState?.routerStatePath
    ),
    authStorePath: resolveAuthStorePath(params.authStorePath ?? integrationState?.authStorePath)
  };
}
