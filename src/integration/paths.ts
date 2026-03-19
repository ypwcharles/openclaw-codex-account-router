import path from "node:path";
import type { IntegrationPaths, IntegrationPlatform } from "./types.js";

export function resolveIntegrationPaths(homeDir: string, platform: IntegrationPlatform): IntegrationPaths {
  const installRoot = path.join(homeDir, ".openclaw-router");
  const binDir = path.join(installRoot, "bin");
  const integrationStatePath = path.join(installRoot, "integration.json");
  const routerCommandPath = path.join(binDir, "openclaw-router");
  const shimPath = path.join(binDir, "openclaw");
  const servicePath =
    platform === "darwin"
      ? path.join(installRoot, "services", "openclaw-router-repair.plist")
      : path.join(installRoot, "services", "openclaw-router-repair.service");

  return {
    installRoot,
    binDir,
    shimPath,
    routerCommandPath,
    integrationStatePath,
    servicePath
  };
}
