import { Command } from "commander";
import { runWithCodexPool } from "../../router/run_with_codex_pool.js";
import type { CodexPoolRunResult, OpenClawExecResult } from "../../router/result.js";
import { resolveAuthStorePath, resolveRouterStatePath } from "../../shared/paths.js";

export async function runRouterCommand(
  params: {
    routerStatePath: string;
    authStorePath: string;
    command: string;
    args: string[];
  },
  deps?: {
    execOpenClaw?: (command: string, args: string[]) => Promise<OpenClawExecResult>;
    now?: () => Date;
  }
): Promise<CodexPoolRunResult> {
  return await runWithCodexPool({
    routerStatePath: params.routerStatePath,
    authStorePath: params.authStorePath,
    command: params.command,
    args: params.args,
    execOpenClaw: deps?.execOpenClaw,
    now: deps?.now
  });
}

export function registerRunCommand(program: Command): void {
  program
    .command("run [commandArgs...]")
    .description("Run OpenClaw with Codex account routing")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .option("--json", "Output JSON", false)
    .action(async (commandArgs, opts) => {
      const list = (commandArgs as string[]).map(String);
      const command = list[0] ?? "openclaw";
      const args = list.length > 1 ? list.slice(1) : ["agent"];
      const result = await runRouterCommand({
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined),
        command,
        args
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.poolExhausted) {
        console.log("Codex account pool exhausted; provider fallback is allowed.");
      } else {
        console.log(`Run succeeded via profiles: ${result.usedProfileIds.join(" -> ")}`);
      }
    });
}
