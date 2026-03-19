import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { bindAccount, listAccounts } from "../account_store/bind.js";
import { loadRouterState, saveRouterState } from "../account_store/store.js";
import {
  detectIntegrationPlatform,
  discoverOpenClawProfiles,
  resolveHomeDir,
  resolveOpenClawBinaryPath
} from "./discovery.js";
import { resolveIntegrationPaths } from "./paths.js";
import { renderServiceDefinition } from "./service_templates.js";
import { installOpenClawShim } from "./shim.js";
import { saveIntegrationState } from "./store.js";
import type { IntegrationPlatform } from "./types.js";

export type SetupResult = {
  installed: true;
  discoveredProfiles: string[];
  integrationStatePath: string;
  shimPath: string;
  servicePath: string;
  routerStatePath: string;
  authStorePath: string;
};

export async function runSetup(
  params: {
    homeDir?: string;
    platform?: IntegrationPlatform;
    routerStatePath?: string;
    authStorePath?: string;
    integrationStatePath?: string;
    projectRoot?: string;
  } = {},
  deps?: {
    discoverOpenClawProfiles?: (authStorePath: string) => Promise<string[]>;
    resolveOpenClawBinary?: () => Promise<string>;
    now?: () => Date;
  }
): Promise<SetupResult> {
  const homeDir = params.homeDir ?? resolveHomeDir();
  const platform = params.platform ?? detectIntegrationPlatform();
  const paths = resolveIntegrationPaths(homeDir, platform);

  const authStorePath = params.authStorePath ?? resolveDefaultAuthStorePath(homeDir);
  const routerStatePath = params.routerStatePath ?? path.join(paths.installRoot, "router-state.json");
  const integrationStatePath = params.integrationStatePath ?? paths.integrationStatePath;

  const discover = deps?.discoverOpenClawProfiles ?? discoverOpenClawProfiles;
  const resolveBinary = deps?.resolveOpenClawBinary ?? resolveOpenClawBinaryPath;
  const now = deps?.now ?? (() => new Date());

  const discoveredProfiles = await discover(authStorePath);
  const realOpenClawPath = await resolveBinary();

  await installRouterCommandLauncher(paths.routerCommandPath, params.projectRoot ?? process.cwd());

  const currentState = await loadRouterState(routerStatePath);
  await saveRouterState(routerStatePath, currentState);

  await ensureBindings({
    discoveredProfiles,
    routerStatePath,
    authStorePath
  });

  await installOpenClawShim({
    shimPath: paths.shimPath,
    routerCommand: paths.routerCommandPath,
    integrationStatePath
  });

  const serviceText = renderServiceDefinition({
    platform,
    installRoot: paths.installRoot
  });
  await mkdir(path.dirname(paths.servicePath), { recursive: true });
  await writeFile(paths.servicePath, serviceText, "utf8");

  await saveIntegrationState(integrationStatePath, {
    version: 1,
    platform,
    installRoot: paths.installRoot,
    shimPath: paths.shimPath,
    realOpenClawPath,
    servicePath: paths.servicePath,
    lastSetupAt: now().toISOString(),
    routerStatePath,
    authStorePath
  });

  return {
    installed: true,
    discoveredProfiles,
    integrationStatePath,
    shimPath: paths.shimPath,
    servicePath: paths.servicePath,
    routerStatePath,
    authStorePath
  };
}

async function ensureBindings(params: {
  discoveredProfiles: string[];
  routerStatePath: string;
  authStorePath: string;
}): Promise<void> {
  const discovered = [...new Set(params.discoveredProfiles.map((id) => id.trim()).filter(Boolean))];
  if (discovered.length === 0) {
    return;
  }

  const existing = await listAccounts(params.routerStatePath);
  const existingAliases = new Set(existing.map((account) => account.alias));
  const existingProfiles = new Set(existing.map((account) => account.profileId));

  let aliasIndex = nextAliasIndex(existingAliases);
  for (const profileId of discovered) {
    if (existingProfiles.has(profileId)) {
      continue;
    }

    const alias = resolveNextAlias(existingAliases, aliasIndex);
    aliasIndex += 1;

    await bindAccount({
      alias,
      profileId,
      routerStatePath: params.routerStatePath,
      authStorePath: params.authStorePath,
      forceDefault: profileId === "openai-codex:default"
    });

    existingAliases.add(alias);
    existingProfiles.add(profileId);
  }
}

function resolveDefaultAuthStorePath(homeDir: string): string {
  return path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
}

function nextAliasIndex(existingAliases: Set<string>): number {
  let max = 0;
  for (const alias of existingAliases) {
    const match = /^acct-(\d+)$/u.exec(alias);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  return max + 1;
}

function resolveNextAlias(existingAliases: Set<string>, start: number): string {
  let index = Math.max(1, start);
  while (existingAliases.has(`acct-${index}`)) {
    index += 1;
  }
  return `acct-${index}`;
}

async function installRouterCommandLauncher(routerCommandPath: string, projectRoot: string): Promise<void> {
  const cliEntry = path.join(projectRoot, "src", "cli", "main.ts");
  const launcher = `#!/usr/bin/env bash\nset -euo pipefail\nexec node --import tsx ${shellEscape(cliEntry)} "$@"\n`;
  await mkdir(path.dirname(routerCommandPath), { recursive: true });
  await writeFile(routerCommandPath, launcher, "utf8");
  await chmod(routerCommandPath, 0o755);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
