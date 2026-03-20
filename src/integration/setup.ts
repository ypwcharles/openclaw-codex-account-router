import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindAccount, listAccounts } from "../account_store/bind.js";
import { loadRouterState, saveRouterState } from "../account_store/store.js";
import { normalizeCodexAuthProfiles } from "./auth_profiles.js";
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

const require = createRequire(import.meta.url);

export type SetupResult = {
  installed: true;
  discoveredProfiles: string[];
  integrationStatePath: string;
  shimPath: string;
  servicePath: string;
  routerStatePath: string;
  authStorePath: string;
  authStoreBackupPath: string;
};

export async function runSetup(
  params: {
    homeDir?: string;
    platform?: IntegrationPlatform;
    routerStatePath?: string;
    authStorePath?: string;
    integrationStatePath?: string;
    routerEntryPath?: string;
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

  const realOpenClawPath = await resolveBinary({ excludePaths: [paths.binDir] });

  const authStoreBackupPath = await ensureAuthStoreBackup(authStorePath, paths.installRoot);
  const migratedProfileIds = await normalizeCodexAuthProfiles(authStorePath);
  await rewriteRouterStateProfileIds(routerStatePath, migratedProfileIds);

  const discoveredProfiles = await discover(authStorePath);

  const routerEntryPath =
    params.routerEntryPath ??
    (params.projectRoot
      ? resolveProjectRootRouterEntryPath(params.projectRoot)
      : resolveDefaultRouterEntryPath());

  await installRouterCommandLauncher(paths.routerCommandPath, routerEntryPath);

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
    authStorePath,
    authStoreBackupPath
  });

  return {
    installed: true,
    discoveredProfiles,
    integrationStatePath,
    shimPath: paths.shimPath,
    servicePath: paths.servicePath,
    routerStatePath,
    authStorePath,
    authStoreBackupPath
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

async function installRouterCommandLauncher(
  routerCommandPath: string,
  routerEntryPath: string
): Promise<void> {
  const entryPath = path.resolve(routerEntryPath);
  const usesTsx = isTypeScriptEntry(entryPath);
  const tsxImport = usesTsx ? resolveTsxLoaderImport() : undefined;
  const launcher = usesTsx
    ? `#!/usr/bin/env bash\nset -euo pipefail\nexec node --import ${shellEscape(tsxImport ?? "tsx")} ${shellEscape(entryPath)} "$@"\n`
    : `#!/usr/bin/env bash\nset -euo pipefail\nexec node ${shellEscape(entryPath)} "$@"\n`;
  await mkdir(path.dirname(routerCommandPath), { recursive: true });
  await writeFile(routerCommandPath, launcher, "utf8");
  await chmod(routerCommandPath, 0o755);
}

function resolveProjectRootRouterEntryPath(projectRoot: string): string {
  const distEntry = path.resolve(projectRoot, "dist", "src", "cli", "main.js");
  if (existsSync(distEntry)) {
    return distEntry;
  }

  const sourceEntry = path.resolve(projectRoot, "src", "cli", "main.ts");
  if (existsSync(sourceEntry)) {
    return sourceEntry;
  }

  throw new Error(`router entry not found under project root: ${projectRoot}`);
}

function resolveDefaultRouterEntryPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const ext = path.extname(currentFile);

  // When running from source, prefer built CLI if available so launcher is
  // stable outside the repo cwd and does not require tsx at runtime.
  if (ext === ".ts") {
    const repoRoot = path.resolve(path.dirname(currentFile), "..", "..");
    const distEntry = path.join(repoRoot, "dist", "src", "cli", "main.js");
    if (existsSync(distEntry)) {
      return distEntry;
    }
  }

  const nextExt = ext === ".ts" || ext === ".js" ? ext : ".js";
  return path.resolve(path.dirname(currentFile), "..", "cli", `main${nextExt}`);
}

function isTypeScriptEntry(entryPath: string): boolean {
  const lower = entryPath.toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts");
}

function resolveTsxLoaderImport(): string {
  try {
    const tsxLoaderPath = require.resolve("tsx");
    return pathToFileURL(tsxLoaderPath).href;
  } catch {
    return "tsx";
  }
}

async function rewriteRouterStateProfileIds(
  routerStatePath: string,
  migratedProfileIds: Record<string, string>
): Promise<void> {
  const entries = Object.entries(migratedProfileIds);
  if (entries.length === 0) {
    return;
  }

  const state = await loadRouterState(routerStatePath);
  let changed = false;
  const nextAccounts = state.accounts.map((account) => {
    const nextProfileId = migratedProfileIds[account.profileId];
    if (!nextProfileId) {
      return account;
    }
    changed = true;
    return {
      ...account,
      profileId: nextProfileId,
      defaultProfileFingerprint: undefined
    };
  });

  if (!changed) {
    return;
  }

  await saveRouterState(routerStatePath, {
    ...state,
    accounts: nextAccounts
  });
}

async function ensureAuthStoreBackup(authStorePath: string, installRoot: string): Promise<string> {
  const backupDir = path.join(installRoot, "backups");
  const backupPath = path.join(backupDir, "auth-profiles.pre-router.json");
  const raw = await readFile(authStorePath, "utf8");
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, raw, "utf8");
  return backupPath;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
