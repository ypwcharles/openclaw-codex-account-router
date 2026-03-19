import { Command } from "commander";
import { resolveIntegrationStatePath } from "../../shared/paths.js";
import { runRepair } from "../../integration/repair.js";

export function registerRepairCommand(program: Command): void {
  program
    .command("repair")
    .description("Repair openclaw-router integration artifacts")
    .option("--integration-state <path>", "Integration state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const result = await runRepair(
        resolveIntegrationStatePath(opts.integrationState as string | undefined)
      );

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("Repair complete.");
      console.log(`Shim: ${result.shimPath}`);
      console.log(`Service: ${result.servicePath}`);
      for (const note of result.notes) {
        console.log(`Next step: ${note}`);
      }
    });
}
