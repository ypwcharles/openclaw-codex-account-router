import { classifyCodexFailure } from "../classifier/codex_error_classifier.js";
import { loadRouterState, saveRouterState } from "../account_store/store.js";
import type { RouterAccount, RouterState } from "../account_store/types.js";
import { mirrorFailureToOpenClaw, mirrorSuccessToOpenClaw, syncCodexOrder } from "./openclaw_auth_store.js";
import type { MirroredFailureReason } from "./openclaw_usage_mirror.js";
import { execOpenClawCommand } from "./openclaw_exec.js";
import type { CodexPoolRunResult, OpenClawExecResult } from "./result.js";
import { selectEligibleAccounts } from "./select_account.js";

export async function runWithCodexPool(params: {
  routerStatePath: string;
  authStorePath: string;
  command: string;
  args: string[];
  execOpenClaw?: (command: string, args: string[]) => Promise<OpenClawExecResult>;
  now?: () => Date;
}): Promise<CodexPoolRunResult> {
  const exec = params.execOpenClaw ?? execOpenClawCommand;
  const nowFn = params.now ?? (() => new Date());
  const state = await loadRouterState(params.routerStatePath);

  const usedProfileIds: string[] = [];
  let lastError = "";

  const retryByProfile = new Map<string, number>();
  let candidates = selectEligibleAccounts(state.accounts, nowFn());
  while (candidates.length > 0) {
    const current = candidates[0];
    if (!current) {
      break;
    }

    usedProfileIds.push(current.profileId);
    const fallbackProfiles = candidates
      .filter((item) => item.profileId !== current.profileId)
      .map((item) => item.profileId);
    await syncCodexOrder(params.authStorePath, [current.profileId, ...fallbackProfiles]);

    try {
      const result = await exec(params.command, params.args);
      const now = nowFn();
      markSuccess(state, current.alias, now);
      await mirrorSuccessToOpenClaw(params.authStorePath, {
        profileId: current.profileId,
        now
      });
      state.lastProviderFallbackReason = undefined;
      await saveRouterState(params.routerStatePath, state);
      return { poolExhausted: false, usedProfileIds, result };
    } catch (error) {
      const message = errorToString(error);
      lastError = message;
      const classified = classifyCodexFailure(message);
      const account = findAccountByAlias(state, current.alias);
      const now = nowFn();

      if (classified.action === "retry") {
        const retryCount = retryByProfile.get(current.profileId) ?? 0;
        if (retryCount < 1) {
          retryByProfile.set(current.profileId, retryCount + 1);
        } else {
          const mirrored = await mirrorFailureToOpenClaw(params.authStorePath, {
            profileId: current.profileId,
            reason: toMirroredFailureReason(classified.reason),
            now
          });
          applyCooldown(account, now, classified.normalizedCode, mirrored.cooldownUntil);
          await saveRouterState(params.routerStatePath, state);
        }
      } else if (classified.action === "cooldown") {
        const mirrored = await mirrorFailureToOpenClaw(params.authStorePath, {
          profileId: current.profileId,
          reason: toMirroredFailureReason(classified.reason),
          now
        });
        applyCooldown(account, now, classified.normalizedCode, mirrored.cooldownUntil);
        await saveRouterState(params.routerStatePath, state);
      } else {
        account.status = "disabled";
        account.cooldownUntil = undefined;
        account.lastFailureAt = now.toISOString();
        account.lastErrorCode = classified.normalizedCode;
        await mirrorFailureToOpenClaw(params.authStorePath, {
          profileId: current.profileId,
          reason: classified.reason === "billing" ? "billing" : "auth_permanent",
          now
        });
        await saveRouterState(params.routerStatePath, state);
      }
    }

    candidates = selectEligibleAccounts(state.accounts, nowFn());
  }

  state.lastProviderFallbackReason = "Codex account pool exhausted";
  await saveRouterState(params.routerStatePath, state);
  return {
    poolExhausted: true,
    usedProfileIds,
    lastError
  };
}

function toMirroredFailureReason(
  reason: "rate_limit" | "auth_permanent" | "billing" | "timeout" | "unknown"
): MirroredFailureReason {
  if (reason === "auth_permanent") {
    return "auth_permanent";
  }
  if (reason === "billing") {
    return "billing";
  }
  if (reason === "timeout") {
    return "timeout";
  }
  if (reason === "unknown") {
    return "unknown";
  }
  return "rate_limit";
}

function findAccountByAlias(state: RouterState, alias: string): RouterAccount {
  const account = state.accounts.find((item) => item.alias === alias);
  if (!account) {
    throw new Error(`account "${alias}" not found`);
  }
  return account;
}

function markSuccess(state: RouterState, alias: string, now: Date): void {
  const account = findAccountByAlias(state, alias);
  account.status = "healthy";
  account.cooldownUntil = undefined;
  account.lastSuccessAt = now.toISOString();
  account.lastErrorCode = undefined;
}

function applyCooldown(
  account: RouterAccount,
  now: Date,
  errorCode: string,
  mirroredCooldownUntil?: number
): void {
  account.status = "cooldown";
  account.lastFailureAt = now.toISOString();
  account.lastErrorCode = errorCode;
  const cooldownMs =
    typeof mirroredCooldownUntil === "number" && Number.isFinite(mirroredCooldownUntil)
      ? mirroredCooldownUntil
      : now.getTime() + 60 * 60 * 1000;
  account.cooldownUntil = new Date(cooldownMs).toISOString();
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
