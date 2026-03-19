import { Command } from "commander";
import { runSetup } from "../../integration/setup.js";

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
      const result = await runSetup({
        homeDir: opts.homeDir as string | undefined,
        platform: opts.platform as "darwin" | "linux" | undefined,
        routerStatePath: opts.routerState as string | undefined,
        authStorePath: opts.authStore as string | undefined,
        integrationStatePath: opts.integrationState as string | undefined
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Installed: ${result.installed ? "yes" : "no"}`);
      console.log(`Discovered profiles: ${result.discoveredProfiles.length}`);
      console.log(`Shim: ${result.shimPath}`);
      console.log(`Service: ${result.servicePath}`);
      console.log(`Auth backup: ${result.authStoreBackupPath}`);
    });
}
