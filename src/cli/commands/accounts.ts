import { Command } from "commander";
import {
  bindAccount,
  clearAccountCooldown,
  listAccounts,
  setAccountEnabled,
  setAccountOrderByAlias
} from "../../account_store/bind.js";
import { resolveAuthStorePath, resolveRouterStatePath } from "../../shared/paths.js";

export function registerAccountsCommands(program: Command): void {
  const accounts = program.command("accounts").description("Manage codex account bindings");

  accounts
    .command("bind")
    .requiredOption("--alias <alias>", "Account alias")
    .requiredOption("--profile-id <profileId>", "OpenClaw auth profile id")
    .option("--priority <priority>", "Priority (lower is earlier)")
    .option("--force-default", "Allow binding openai-codex:default", false)
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .action(async (opts) => {
      const result = await bindAccount({
        alias: String(opts.alias),
        profileId: String(opts.profileId),
        priority:
          typeof opts.priority === "string" && /^\d+$/.test(opts.priority)
            ? Number(opts.priority)
            : undefined,
        forceDefault: Boolean(opts.forceDefault),
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined)
      });
      console.log(
        `bound ${result.account.alias} -> ${result.account.profileId} (priority=${result.account.priority})`
      );
    });

  accounts
    .command("list")
    .option("--router-state <path>", "Router state path")
    .action(async (opts) => {
      const accounts = await listAccounts(resolveRouterStatePath(opts.routerState as string | undefined));
      if (accounts.length === 0) {
        console.log("(no accounts)");
        return;
      }
      for (const account of accounts) {
        console.log(
          `${account.alias}\t${account.profileId}\tpriority=${account.priority}\tenabled=${account.enabled}\tstatus=${account.status}`
        );
      }
    });

  accounts
    .command("enable")
    .argument("<alias>", "Account alias")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .action(async (alias, opts) => {
      await setAccountEnabled({
        alias: String(alias),
        enabled: true,
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined)
      });
      console.log(`enabled ${alias}`);
    });

  accounts
    .command("disable")
    .argument("<alias>", "Account alias")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .action(async (alias, opts) => {
      await setAccountEnabled({
        alias: String(alias),
        enabled: false,
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined)
      });
      console.log(`disabled ${alias}`);
    });

  const order = accounts.command("order").description("Manage account order");

  order
    .command("set")
    .argument("<aliases...>", "Aliases in desired order")
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .action(async (aliases, opts) => {
      await setAccountOrderByAlias({
        aliases: (aliases as string[]).map(String),
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined),
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined)
      });
      console.log(`updated order: ${(aliases as string[]).join(", ")}`);
    });

  const cooldown = program.command("cooldown").description("Manage cooldown state");
  cooldown
    .command("clear")
    .argument("<alias>", "Account alias")
    .option("--router-state <path>", "Router state path")
    .action(async (alias, opts) => {
      await clearAccountCooldown({
        alias: String(alias),
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined)
      });
      console.log(`cleared cooldown for ${alias}`);
    });
}
