import { Command } from "commander";
import {
  bindAccount,
  listAccounts,
  setAccountEnabled,
  setAccountOrderByAlias
} from "../../account_store/bind.js";
import { resolveAuthStorePath, resolveRouterStatePath } from "../../shared/paths.js";

export function registerAccountCommand(program: Command): void {
  const account = program.command("account").description("Manage routed codex accounts");

  account
    .command("list")
    .option("--router-state <path>", "Router state path")
    .action(async (opts) => {
      const accounts = await listAccounts(resolveRouterStatePath(opts.routerState as string | undefined));
      if (accounts.length === 0) {
        console.log("(no accounts)");
        return;
      }
      for (const item of accounts) {
        console.log(
          `${item.alias}\t${item.profileId}\tpriority=${item.priority}\tenabled=${item.enabled}\tstatus=${item.status}`
        );
      }
    });

  account
    .command("add")
    .requiredOption("--profile-id <profileId>", "OpenClaw auth profile id")
    .option("--alias <alias>", "Account alias (default: next acct-N)")
    .option("--priority <priority>", "Priority (lower is earlier)")
    .option("--force-default", "Allow binding openai-codex:default", false)
    .option("--router-state <path>", "Router state path")
    .option("--auth-store <path>", "OpenClaw auth store path")
    .action(async (opts) => {
      const routerStatePath = resolveRouterStatePath(opts.routerState as string | undefined);
      const alias =
        typeof opts.alias === "string" && opts.alias.trim()
          ? opts.alias.trim()
          : await resolveNextAlias(routerStatePath);

      const result = await bindAccount({
        alias,
        profileId: String(opts.profileId),
        priority:
          typeof opts.priority === "string" && /^\d+$/u.test(opts.priority)
            ? Number(opts.priority)
            : undefined,
        forceDefault: Boolean(opts.forceDefault),
        routerStatePath,
        authStorePath: resolveAuthStorePath(opts.authStore as string | undefined)
      });
      console.log(
        `bound ${result.account.alias} -> ${result.account.profileId} (priority=${result.account.priority})`
      );
    });

  account
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

  account
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

  account
    .command("order")
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
}

async function resolveNextAlias(routerStatePath: string): Promise<string> {
  const accounts = await listAccounts(routerStatePath);
  const used = new Set(accounts.map((item) => item.alias));
  let index = 1;
  while (used.has(`acct-${index}`)) {
    index += 1;
  }
  return `acct-${index}`;
}
