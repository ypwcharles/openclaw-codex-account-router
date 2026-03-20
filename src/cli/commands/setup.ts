import { Command } from "commander";
import { execa } from "execa";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runSetup } from "../../integration/setup.js";
import { detectIntegrationPlatform, resolveHomeDir } from "../../integration/discovery.js";
import {
  renderPathBlock,
  resolveShellProfile,
  upsertManagedPathBlock
} from "../../integration/managed_path.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Install or refresh openclaw-router integration artifacts")
    .option("--home-dir <path>", "Home directory override")
    .option("--platform <platform>", "Platform override (darwin|linux)")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const platform = resolveRequestedPlatform(opts.platform as string | undefined);
      const result = await runSetup({
        homeDir: opts.homeDir as string | undefined,
        platform,
        routerStatePath: opts.routerState as string | undefined,
        authStorePath: opts.authStore as string | undefined,
        integrationStatePath: opts.integrationState as string | undefined
      });

      const homeDir = (opts.homeDir as string | undefined) ?? resolveHomeDir();
      const pathIntegration = await ensureManagedPathIntegration({
        homeDir,
        shimPath: result.shimPath
      });
      const guidance = buildSetupGuidance({
        platform,
        integrationStatePath: result.integrationStatePath,
        authStorePath: result.authStorePath,
        pathIntegration
      });

      if (opts.json) {
        console.log(JSON.stringify({ ...result, guidance }, null, 2));
        return;
      }

      console.log(`Installed: ${result.installed ? "yes" : "no"}`);
      console.log(`Discovered profiles: ${result.discoveredProfiles.length}`);
      console.log(`Shim: ${result.shimPath}`);
      console.log(`Service: ${result.servicePath}`);
      console.log(`Auth backup: ${result.authStoreBackupPath}`);
      console.log(`PATH: ${guidance.pathStatus}`);
      console.log(`Repair: ${guidance.repairCommand}`);
      console.log(`Undo: ${guidance.undoCommand}`);
      console.log(`Inspect service: ${guidance.inspectCommand}`);
    });
}

function resolveRequestedPlatform(raw: string | undefined): "darwin" | "linux" {
  if (raw === "darwin" || raw === "linux") {
    return raw;
  }
  if (raw) {
    throw new Error(`unsupported platform: ${raw}`);
  }
  return detectIntegrationPlatform();
}

type ManagedPathIntegration = {
  status: "active" | "updated" | "failed";
  profilePath?: string;
  message?: string;
};

async function ensureManagedPathIntegration(params: {
  homeDir: string;
  shimPath: string;
}): Promise<ManagedPathIntegration> {
  const activeOpenClaw = await resolveActiveOpenClawPath();
  if (activeOpenClaw === params.shimPath) {
    return {
      status: "active"
    };
  }

  const managedBinDir = path.dirname(params.shimPath);
  const shellProfile = resolveShellProfile(process.env.SHELL, params.homeDir);
  const block = renderPathBlock(shellProfile.syntax, managedBinDir);
  if (!block) {
    return {
      status: "failed",
      message: `unsupported shell profile syntax: ${shellProfile.syntax}`
    };
  }

  try {
    await mkdir(path.dirname(shellProfile.path), { recursive: true });
    const before = await readFile(shellProfile.path, "utf8").catch(() => "");
    const after = upsertManagedPathBlock(before, block);
    if (after !== before) {
      await writeFile(shellProfile.path, after, "utf8");
    }
    return {
      status: "updated",
      profilePath: shellProfile.path
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      profilePath: shellProfile.path,
      message
    };
  }
}

function resolveActiveOpenClawPath(): Promise<string | undefined> {
  return execa("which", ["openclaw"], { reject: false })
    .then((result) => {
      if (result.exitCode !== 0) {
        return undefined;
      }
      const resolved = result.stdout.trim();
      return resolved || undefined;
    })
    .catch(() => undefined);
}

function buildSetupGuidance(params: {
  platform: "darwin" | "linux";
  integrationStatePath: string;
  authStorePath: string;
  pathIntegration: ManagedPathIntegration;
}): {
  pathStatus: string;
  repairCommand: string;
  undoCommand: string;
  inspectCommand: string;
} {
  const pathStatus = renderPathStatus(params.pathIntegration);
  return {
    pathStatus,
    repairCommand: `openclaw-router repair --integration-state ${params.integrationStatePath}`,
    undoCommand:
      `openclaw-router restore --integration-state ${params.integrationStatePath} ` +
      `--auth-store ${params.authStorePath}`,
    inspectCommand:
      params.platform === "darwin"
        ? "launchctl print gui/$(id -u)/dev.openclaw-router.repair"
        : "systemctl --user status openclaw-router-repair.service"
  };
}

function renderPathStatus(pathIntegration: ManagedPathIntegration): string {
  if (pathIntegration.status === "active") {
    return "managed shim already active in current PATH";
  }
  if (pathIntegration.status === "updated") {
    const profile = pathIntegration.profilePath ?? "shell profile";
    return `updated ${profile}; open a new shell session to activate`;
  }
  const message = pathIntegration.message ? ` (${pathIntegration.message})` : "";
  const profile = pathIntegration.profilePath ? ` at ${pathIntegration.profilePath}` : "";
  return `could not auto-configure PATH${profile}${message}`;
}
