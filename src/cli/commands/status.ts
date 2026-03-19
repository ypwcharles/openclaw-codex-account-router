import { Command } from "commander";
import { loadRouterState } from "../../account_store/store.js";
import { resolveRouterStatePath } from "../../shared/paths.js";
import { selectEligibleAccounts } from "../../router/select_account.js";

export type RouterStatusPayload = {
  currentOrder: string[];
  activeAccounts: string[];
  nextCandidate?: string;
  cooldowns: Array<{ alias: string; until?: string }>;
  lastErrorCodes: Array<{ alias: string; code?: string }>;
  lastProviderFallbackReason?: string;
};

export async function getRouterStatus(params: {
  routerStatePath: string;
  now?: Date;
}): Promise<RouterStatusPayload> {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const state = await loadRouterState(params.routerStatePath);
  const currentOrder = state.accounts
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((account) => account.alias);
  const activeAccounts = selectEligibleAccounts(state.accounts, now).map((account) => account.alias);
  const nextCandidate = activeAccounts[0];
  const cooldowns = state.accounts
    .filter((account) => account.status === "cooldown")
    .filter((account) => isEffectiveCooldown(account.cooldownUntil, nowMs))
    .map((account) => ({ alias: account.alias, until: account.cooldownUntil }));
  const lastErrorCodes = state.accounts.map((account) => ({
    alias: account.alias,
    code: account.lastErrorCode
  }));

  return {
    currentOrder,
    activeAccounts,
    nextCandidate,
    cooldowns,
    lastErrorCodes,
    lastProviderFallbackReason: state.lastProviderFallbackReason
  };
}

function isEffectiveCooldown(cooldownUntil: string | undefined, nowMs: number): boolean {
  if (!cooldownUntil) {
    return true;
  }
  const parsed = Date.parse(cooldownUntil);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return parsed > nowMs;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show router status")
    .option("--router-state <path>", "Router state path")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const payload = await getRouterStatus({
        routerStatePath: resolveRouterStatePath(opts.routerState as string | undefined)
      });
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(`Current order: ${payload.currentOrder.join(", ") || "(none)"}`);
      console.log(`Active accounts: ${payload.activeAccounts.join(", ") || "(none)"}`);
      console.log(`Next candidate: ${payload.nextCandidate ?? "(none)"}`);
      if (payload.lastProviderFallbackReason) {
        console.log(`Last provider fallback reason: ${payload.lastProviderFallbackReason}`);
      }
    });
}
