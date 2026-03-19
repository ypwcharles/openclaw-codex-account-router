import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { Command } from "commander";
import { loadRouterState } from "../../account_store/store.js";
import { loadIntegrationState } from "../../integration/store.js";
import {
  resolveAuthStorePath,
  resolveOptionalIntegrationStatePath,
  resolveRouterStatePath
} from "../../shared/paths.js";

type DoctorCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export async function runDoctor(params: {
  routerStatePath: string;
  authStorePath: string;
  integrationStatePath?: string;
}): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkOpenClawBinary());
  checks.push(await checkAuthStoreAccess(params.authStorePath));
  checks.push(...(await checkAliasMappings(params.routerStatePath, params.authStorePath)));

  if (params.integrationStatePath) {
    checks.push(...(await checkIntegrationHealth(params.integrationStatePath)));
  }

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate account router wiring")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const result = await runDoctor({
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined),
        integrationStatePath: resolveOptionalIntegrationStatePath(
          opts.integrationState as string | undefined
        )
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const check of result.checks) {
        console.log(`${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.detail}`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}

async function checkOpenClawBinary(): Promise<DoctorCheck> {
  try {
    const result = await execa("openclaw", ["--help"], { reject: false, timeout: 3000 });
    if (result.exitCode === 0) {
      return { id: "openclaw_binary", ok: true, detail: "openclaw is available" };
    }
    return {
      id: "openclaw_binary",
      ok: false,
      detail: `openclaw --help exited with status ${result.exitCode ?? "unknown"}`
    };
  } catch {
    return { id: "openclaw_binary", ok: false, detail: "openclaw binary not found in PATH" };
  }
}

async function checkAuthStoreAccess(authStorePath: string): Promise<DoctorCheck> {
  try {
    await access(authStorePath, constants.R_OK | constants.W_OK);
    return { id: "auth_store_access", ok: true, detail: authStorePath };
  } catch {
    return { id: "auth_store_access", ok: false, detail: `cannot read/write ${authStorePath}` };
  }
}

async function checkAliasMappings(
  routerStatePath: string,
  authStorePath: string
): Promise<DoctorCheck[]> {
  const state = await loadRouterState(routerStatePath);
  const checks: DoctorCheck[] = [];
  let profiles: Record<string, unknown> = {};

  try {
    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      profiles?: Record<string, unknown>;
    };
    profiles = authStore.profiles ?? {};
  } catch {
    checks.push({
      id: "alias_profile_mapping",
      ok: false,
      detail: `cannot read/parse auth store: ${authStorePath}`
    });
    checks.push({
      id: "default_profile_duplicate",
      ok: false,
      detail: "skipped because auth store is unavailable"
    });
    return checks;
  }

  const missing = state.accounts
    .filter((account) => !(account.profileId in profiles))
    .map((account) => `${account.alias}:${account.profileId}`);
  checks.push({
    id: "alias_profile_mapping",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "all aliases map to existing profiles" : missing.join(", ")
  });

  const defaultUsers = state.accounts.filter((account) => account.profileId === "openai-codex:default");
  checks.push({
    id: "default_profile_duplicate",
    ok: defaultUsers.length <= 1,
    detail:
      defaultUsers.length <= 1
        ? "default profile used by at most one alias"
        : `default profile used by multiple aliases: ${defaultUsers.map((x) => x.alias).join(", ")}`
  });
  return checks;
}

async function checkIntegrationHealth(integrationStatePath: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const integration = await loadIntegrationState(integrationStatePath);
  if (!integration) {
    checks.push({
      id: "integration_state_readable",
      ok: false,
      detail: `integration state missing: ${integrationStatePath}`
    });
    checks.push({
      id: "integration_shim_exists",
      ok: false,
      detail: "skipped because integration state is unavailable"
    });
    checks.push({
      id: "integration_service_exists",
      ok: false,
      detail: "skipped because integration state is unavailable"
    });
    return checks;
  }

  checks.push({
    id: "integration_state_readable",
    ok: true,
    detail: integrationStatePath
  });

  const shimOk = await checkPathReadable(integration.shimPath);
  checks.push({
    id: "integration_shim_exists",
    ok: shimOk,
    detail: shimOk ? integration.shimPath : `missing shim: ${integration.shimPath}`
  });

  const serviceOk = await checkPathReadable(integration.servicePath);
  checks.push({
    id: "integration_service_exists",
    ok: serviceOk,
    detail: serviceOk ? integration.servicePath : `missing service: ${integration.servicePath}`
  });

  const pathAdvice = checkPathOrder(integration.shimPath, integration.realOpenClawPath, process.env.PATH ?? "");
  checks.push(pathAdvice);

  return checks;
}

async function checkPathReadable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function checkPathOrder(shimPath: string, realOpenClawPath: string, pathEnv: string): DoctorCheck {
  const pathParts = pathEnv.split(path.delimiter).filter(Boolean);
  const shimDir = path.dirname(shimPath);
  const realDir = path.dirname(realOpenClawPath);
  const shimIndex = pathParts.indexOf(shimDir);
  const realIndex = pathParts.indexOf(realDir);

  const ok = shimIndex >= 0 && (realIndex < 0 || shimIndex < realIndex);
  return {
    id: "integration_path_precedence",
    ok,
    detail: ok
      ? `${shimDir} is ahead of ${realDir} in PATH`
      : `add ${shimDir} before ${realDir} in PATH`
  };
}
