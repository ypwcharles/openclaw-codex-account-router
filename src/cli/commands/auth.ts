import { Command } from "commander";
import { execa } from "execa";
import { normalizeCodexAuthProfiles } from "../../integration/auth_profiles.js";
import { resolveAuthStorePath } from "../../shared/paths.js";

type AuthLoginExecResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

export async function runCodexAuthLogin(
  params: {
    authStorePath: string;
    command: string;
    args: string[];
  },
  deps?: {
    execOpenClawLogin?: (command: string, args: string[]) => Promise<AuthLoginExecResult>;
  }
): Promise<{ migratedProfileIds: string[] }> {
  const execOpenClawLogin = deps?.execOpenClawLogin ?? execInteractiveOpenClawLogin;
  await execOpenClawLogin(params.command, params.args);
  const migratedProfileIds = Object.values(await normalizeCodexAuthProfiles(params.authStorePath));
  return { migratedProfileIds };
}

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Wrap OpenClaw auth flows with router-safe fixes");

  auth
    .command("login")
    .description("Login to openai-codex without overwriting previously normalized accounts")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const result = await runCodexAuthLogin({
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined),
        command: "openclaw",
        args: ["models", "auth", "login", "--provider", "openai-codex"]
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.migratedProfileIds.length > 0) {
        console.log(`Normalized profiles: ${result.migratedProfileIds.join(", ")}`);
      }
    });
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
