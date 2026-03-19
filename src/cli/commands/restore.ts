import path from "node:path";
import { Command } from "commander";
import { runRestore } from "../../integration/restore.js";
import { resolveIntegrationStatePath } from "../../shared/paths.js";

export function registerRestoreCommand(program: Command): void {
  program
    .command("restore")
    .description("Restore OpenClaw auth store from setup backup")
    .option("--integration-state <path>", "Integration state path")
    .option("--auth-store <path>", "OpenClaw auth store path override")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const result = await runRestore({
        integrationStatePath: resolveIntegrationStatePath(opts.integrationState as string | undefined),
        authStorePath:
          typeof opts.authStore === "string" && opts.authStore.trim()
            ? path.resolve(opts.authStore.trim())
            : undefined
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("Restore complete.");
      console.log(`Auth store: ${result.authStorePath}`);
      console.log(`Backup: ${result.backupPath}`);
    });
}

