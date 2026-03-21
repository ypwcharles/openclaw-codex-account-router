import { Command } from "commander";
import { execa } from "execa";
import { normalizeCodexAuthProfiles } from "../../integration/auth_profiles.js";
import { ensureBindingsForProfiles } from "../../integration/bindings.js";
import { loadIntegrationState } from "../../integration/store.js";
import { resolveAuthStorePath, resolveOptionalIntegrationStatePath, resolveRouterStatePath } from "../../shared/paths.js";

type AuthLoginExecResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

type OpenAIOAuthProbeResult =
  | {
      status: "reachable";
      httpStatus: number;
    }
  | {
      status: "network_error";
      message: string;
      code?: string;
    };

export async function runCodexAuthLogin(
  params: {
    authStorePath: string;
    command: string;
    args: string[];
  },
  deps?: {
    execOpenClawLogin?: (command: string, args: string[]) => Promise<AuthLoginExecResult>;
    probeOpenAIOAuthToken?: () => Promise<OpenAIOAuthProbeResult>;
  }
): Promise<{ migratedProfileIds: string[] }> {
  const execOpenClawLogin = deps?.execOpenClawLogin ?? execInteractiveOpenClawLogin;
  try {
    await execOpenClawLogin(params.command, params.args);
  } catch (error) {
    const diagnosis = await diagnoseOpenAICodexLoginFailure(
      params.args,
      deps?.probeOpenAIOAuthToken ?? probeOpenAIOAuthToken
    );
    if (diagnosis) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n${diagnosis}`);
    }
    throw error;
  }
  const migratedProfileIds = Object.values(await normalizeCodexAuthProfiles(params.authStorePath));
  return { migratedProfileIds };
}

export async function runCodexAuthNormalize(params: {
  authStorePath: string;
}): Promise<{ migratedProfileIds: string[] }> {
  const migratedProfileIds = Object.values(await normalizeCodexAuthProfiles(params.authStorePath));
  return { migratedProfileIds };
}

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Wrap OpenClaw auth flows with router-safe fixes");

  auth
    .command("login")
    .description("Login to openai-codex without overwriting previously normalized accounts")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const integrationState = await loadOptionalIntegrationState(
        opts.integrationState as string | undefined
      );
      const authStorePath = resolveAuthStorePath(
        ((opts.authStore as string | undefined) ?? integrationState?.authStorePath) as string | undefined
      );
      const routerStatePath = resolveRouterStatePath(integrationState?.routerStatePath);
      const result = await runCodexAuthLogin({
        authStorePath,
        command: await resolveAuthLoginCommand(opts.integrationState as string | undefined),
        args: ["models", "auth", "login", "--provider", "openai-codex"]
      });
      const boundAccounts = await ensureBindingsForProfiles({
        profileIds: result.migratedProfileIds,
        routerStatePath,
        authStorePath
      });

      if (opts.json) {
        console.log(JSON.stringify({ ...result, boundAccounts }, null, 2));
        return;
      }

      if (result.migratedProfileIds.length > 0) {
        console.log(`Normalized profiles: ${result.migratedProfileIds.join(", ")}`);
      }
      if (boundAccounts.length > 0) {
        console.log(
          `Added routed accounts: ${boundAccounts.map((item) => `${item.alias} -> ${item.profileId}`).join(", ")}`
        );
      }
    });

  auth
    .command("normalize")
    .description("Normalize the existing OpenClaw auth store into stable email-based codex profiles")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const integrationState = await loadOptionalIntegrationState(
        opts.integrationState as string | undefined
      );
      const authStorePath = resolveAuthStorePath(
        ((opts.authStore as string | undefined) ?? integrationState?.authStorePath) as string | undefined
      );
      const routerStatePath = resolveRouterStatePath(integrationState?.routerStatePath);
      const result = await runCodexAuthNormalize({
        authStorePath
      });
      const boundAccounts = await ensureBindingsForProfiles({
        profileIds: result.migratedProfileIds,
        routerStatePath,
        authStorePath
      });

      if (opts.json) {
        console.log(JSON.stringify({ ...result, boundAccounts }, null, 2));
        return;
      }

      if (result.migratedProfileIds.length > 0) {
        console.log(`Normalized profiles: ${result.migratedProfileIds.join(", ")}`);
      }
      if (boundAccounts.length > 0) {
        console.log(
          `Added routed accounts: ${boundAccounts.map((item) => `${item.alias} -> ${item.profileId}`).join(", ")}`
        );
      }
      if (result.migratedProfileIds.length === 0 && boundAccounts.length === 0) {
        console.log("No codex profiles needed normalization.");
      }
    });
}

async function resolveAuthLoginCommand(explicitIntegrationStatePath?: string): Promise<string> {
  const integrationStatePath = resolveOptionalIntegrationStatePath(explicitIntegrationStatePath);
  if (!integrationStatePath) {
    return "openclaw";
  }

  const integrationState = await loadOptionalIntegrationState(explicitIntegrationStatePath);
  return integrationState?.realOpenClawPath?.trim() || "openclaw";
}

async function execInteractiveOpenClawLogin(
  command: string,
  args: string[]
): Promise<AuthLoginExecResult> {
  const result = await execa(command, args, {
    reject: false,
    stdio: "inherit"
  });

  if (result.exitCode !== 0) {
    throw new Error(`openclaw login failed with status ${result.exitCode ?? "unknown"}`);
  }

  return {
    exitCode: result.exitCode ?? 0
  };
}

async function diagnoseOpenAICodexLoginFailure(
  args: string[],
  probe: () => Promise<OpenAIOAuthProbeResult>
): Promise<string | undefined> {
  if (!isOpenAICodexLoginArgs(args)) {
    return undefined;
  }

  const probeResult = await probe();
  if (probeResult.status === "network_error") {
    return [
      "Router probe: auth.openai.com/oauth/token is not reachable from this shell.",
      probeResult.code ? `Cause: ${probeResult.code} (${probeResult.message})` : `Cause: ${probeResult.message}`
    ].join("\n");
  }

  return [
    `Router probe: auth.openai.com/oauth/token is reachable (HTTP ${probeResult.httpStatus} with a dummy code).`,
    "This usually means the browser callback URL was accepted, but OpenClaw failed later while exchanging or validating the one-time authorization code.",
    "Retry with a fresh callback URL and do not reuse an older code."
  ].join("\n");
}

function isOpenAICodexLoginArgs(args: string[]): boolean {
  return (
    args.length >= 5 &&
    args[0] === "models" &&
    args[1] === "auth" &&
    args[2] === "login" &&
    args.includes("--provider") &&
    args[args.indexOf("--provider") + 1] === "openai-codex"
  );
}

async function probeOpenAIOAuthToken(): Promise<OpenAIOAuthProbeResult> {
  try {
    const response = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        code: "router-probe-invalid-code",
        code_verifier: "router-probe-invalid-verifier",
        redirect_uri: "http://localhost:1455/auth/callback"
      }),
      signal: AbortSignal.timeout(5000)
    });

    return {
      status: "reachable",
      httpStatus: response.status
    };
  } catch (error) {
    const details = asErrorWithCause(error);
    return {
      status: "network_error",
      message: details.message,
      code: details.code
    };
  }
}

function asErrorWithCause(error: unknown): { message: string; code?: string } {
  const topLevel = error as { message?: unknown; cause?: unknown } | null;
  const cause = (topLevel?.cause ?? null) as { code?: unknown; message?: unknown } | null;
  return {
    message:
      typeof cause?.message === "string"
        ? cause.message
        : typeof topLevel?.message === "string"
          ? topLevel.message
          : String(error),
    code: typeof cause?.code === "string" ? cause.code : undefined
  };
}

async function loadOptionalIntegrationState(
  explicitIntegrationStatePath?: string
): Promise<
  | {
      realOpenClawPath?: string;
      routerStatePath?: string;
      authStorePath?: string;
    }
  | undefined
> {
  const integrationStatePath = resolveOptionalIntegrationStatePath(explicitIntegrationStatePath);
  if (!integrationStatePath) {
    return undefined;
  }

  try {
    return await loadIntegrationState(integrationStatePath);
  } catch {
    return undefined;
  }
}
